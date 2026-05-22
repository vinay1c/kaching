/**
 * KaChing — Receipt-PDF upload + PWA host + report-query endpoint.
 * Google Apps Script web app (Receipt Uploader project).
 *
 * HOW TO DEPLOY
 * ─────────────
 * 1. Open script.google.com → "Receipt Uploader" project.
 * 2. REPLACE Code.gs content with this file.
 * 3. ADD a new HTML file: click "+" → HTML → name it exactly  kaching1
 *    Paste the full contents of kaching1.html into it.
 * 4. Fill in the four constants below.
 * 5. Deploy → New deployment → Web app
 *      Execute as:  Me
 *      Who can access: Anyone
 * 6. Copy the new deployment URL into APPS_SCRIPT_URL below AND into
 *    the matching constant at the top of kaching1.html, then redeploy.
 *
 * ROUTES (doGet)
 * ─────────────
 *   (no params)           → serves kaching1.html   (the PWA app)
 *   ?file=manifest        → Web App Manifest JSON
 *   ?file=sw              → Service Worker JS
 *   ?file=icon            → KaChing SVG icon
 *   ?action=lastTransaction&secret=…  → last expense JSON
 *   ?action=totalAmount&secret=…      → running total JSON
 *   ?action=download&id=FILE_ID&secret=…  → base64 PDF from ReceiptInbox
 *     Returns: {"ok":true,"name":"R01.pdf","content":"BASE64..."}
 *     Security: only serves files whose parent folder is TARGET_FOLDER_ID.
 *     Usage (Cowork bash):
 *       curl "URL?action=download&id=ID&secret=SECRET" \
 *         | python3 -c "import sys,base64,json; \
 *             open('out.pdf','wb').write(base64.b64decode(json.loads(sys.stdin.read())['content']))"
 *
 * doPost — PDF receipt upload (unchanged from pre-PWA version).
 */

// ===========================================================================
// === FILL IN BEFORE DEPLOYING ===============================================
// ===========================================================================

// The full deployment URL of THIS script (needed for manifest start_url & icon).
// After first deploy, copy the URL here and redeploy once more.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxf8Lptuidg5sjE6ySfBb9KfA4QbiQF7Ue8yx9oKX1Eccx1506AQKLOiwFEf8YTAc5r/exec';

// Drive folder ID where receipt PDFs land (GRoot\ReceiptInbox).
const TARGET_FOLDER_ID = '1xKYqgqbaae5tVPJ1SHre2WdWrQYsMM7i';

// Drive folder ID for GRoot\Output (contains expense_summary.json).
const OUTPUT_FOLDER_ID = '1N8VaQkgHhH5tdDZE6ZDJU5x_6oZD3hPq';

// Shared secret — must match the value in kaching1.html.
const SHARED_SECRET = 'fdd1e8638cdcfaaef62ec125327165f71a19e3bbacd3ccee';

// Hard cap on uploaded PDF size, in bytes.
const MAX_BYTES = 10 * 1024 * 1024;

// ===========================================================================
// === GET — PWA resources + report queries ==================================
// ===========================================================================

function doGet(e) {
  var params = (e && e.parameter) || {};
  var file   = params.file   || '';
  var action = params.action || '';
  var secret = params.secret || '';

  // ── Public resources (no auth required — browser fetches these automatically)
  if (file === 'manifest') return serveManifest();
  if (file === 'sw')       return serveServiceWorker();
  if (file === 'icon')     return serveIcon();

  // ── Default: serve the KaChing app (kaching1 HTML file in this project)
  if (!file && !action) return serveApp();

  // ── Authenticated data actions ──────────────────────────────────────────
  if (secret.length !== SHARED_SECRET.length || secret !== SHARED_SECRET) {
    return _json({ ok: false, error: 'unauthorized' });
  }
  if (action === 'lastTransaction') return getLastTransaction();
  if (action === 'totalAmount')     return getTotalAmount();
  if (action === 'download')        return downloadFile(params.id || '');

  return _json({ ok: false, error: 'unknown action' });
}

// ---------------------------------------------------------------------------
function serveApp() {
  // kaching1.html must exist as an HTML file in this Apps Script project.
  return HtmlService.createHtmlOutputFromFile('kaching1')
    .setTitle('KaChing')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------------------------------------------------------------------------
function serveManifest() {
  var manifest = {
    name:             'KaChing',
    short_name:       'KaChing',
    description:      'TWI Expense Receipt Capture',
    start_url:        APPS_SCRIPT_URL,
    display:          'standalone',
    background_color: '#214074',
    theme_color:      '#214074',
    icons: [
      {
        src:     'https://vinay1c.github.io/kaching/icon-192.png',
        sizes:   '192x192',
        type:    'image/png',
        purpose: 'any maskable'
      },
      {
        src:     'https://vinay1c.github.io/kaching/icon-512.png',
        sizes:   '512x512',
        type:    'image/png',
        purpose: 'any maskable'
      }
    ]
  };
  return ContentService
    .createTextOutput(JSON.stringify(manifest))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
function serveServiceWorker() {
  // Minimal service worker — satisfies Chrome's PWA install requirement.
  // Cross-origin requests (e.g. POST to Apps Script) are NOT intercepted so
  // they flow through the browser's native CORS/fetch stack unmodified.
  var sw = [
    '/* KaChing Service Worker */',
    'self.addEventListener("install",  function() { self.skipWaiting(); });',
    'self.addEventListener("activate", function(e) { e.waitUntil(self.clients.claim()); });',
    'self.addEventListener("fetch",    function(e) {',
    '  // Skip cross-origin requests — let the browser handle them natively.',
    '  if (new URL(e.request.url).origin !== self.location.origin) return;',
    '  e.respondWith(fetch(e.request).catch(function() {',
    '    return caches.match(e.request);',
    '  }));',
    '});'
  ].join('\n');
  return ContentService
    .createTextOutput(sw)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ---------------------------------------------------------------------------
function serveIcon() {
  // KaChing icon: navy background, olive coin, navy $ symbol, white KACHING label.
  // Replace this SVG string to update the icon without touching anything else.
  var svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
      '<rect width="512" height="512" rx="80" fill="#214074"/>' +
      '<circle cx="256" cy="220" r="155" fill="#a1b954"/>' +
      '<text x="256" y="288"' +
        ' font-family="Arial Black,Impact,Helvetica Neue,sans-serif"' +
        ' font-weight="900" font-size="195" fill="#214074"' +
        ' text-anchor="middle">$</text>' +
      '<rect x="56" y="400" width="400" height="56" rx="28" fill="#a1b954"/>' +
      '<text x="256" y="443"' +
        ' font-family="Arial,Helvetica,sans-serif"' +
        ' font-weight="700" font-size="46" fill="#214074"' +
        ' text-anchor="middle" letter-spacing="6">KACHING</text>' +
    '</svg>';
  // Note: Apps Script ContentService has no image/svg+xml MIME type;
  // XML is used instead. Chrome on Android accepts this for manifest icons.
  return ContentService
    .createTextOutput(svg)
    .setMimeType(ContentService.MimeType.XML);
}

// ===========================================================================
// === POST — receipt upload (unchanged) =====================================
// ===========================================================================

function doPost(e) {
  try {
    // 1. Auth
    var got = (e && e.parameter && e.parameter.secret) || '';
    if (got.length !== SHARED_SECRET.length || got !== SHARED_SECRET) {
      return _json({ ok: false, error: 'unauthorized' });
    }

    // 2. Payload
    var b64 = (e.parameter.content) || '';
    if (!b64) return _json({ ok: false, error: 'missing content' });

    // 3. Decode + size cap
    var bytes;
    try { bytes = Utilities.base64Decode(b64); }
    catch (err) { return _json({ ok: false, error: 'bad base64' }); }
    if (bytes.length === 0)       return _json({ ok: false, error: 'empty payload' });
    if (bytes.length > MAX_BYTES) return _json({ ok: false, error: 'too large (' + bytes.length + ' B)' });

    // 4. PDF magic-bytes check
    if (bytes.length < 5 ||
        bytes[0] !== 0x25 || bytes[1] !== 0x50 ||
        bytes[2] !== 0x44 || bytes[3] !== 0x46 ||
        bytes[4] !== 0x2D) {
      return _json({ ok: false, error: 'not a PDF (magic bytes missing)' });
    }

    // 5. Filename sanitization
    var rawName = (e.parameter.filename) || ('receipt-' + Date.now() + '.pdf');
    var name = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 120);
    if (!/\.pdf$/i.test(name)) name += '.pdf';

    // 6. Save PDF
    var blob   = Utilities.newBlob(bytes, 'application/pdf', name);
    var folder = DriveApp.getFolderById(TARGET_FOLDER_ID);
    var file   = folder.createFile(blob);

    // 7. Save notes sidecar (J prefix keeps JSON files sorted separately from PDFs)
    var notes    = (e.parameter.notes != null) ? String(e.parameter.notes) : '';
    var baseName = name.replace(/\.pdf$/i, '');
    var notesBlob = Utilities.newBlob(
      JSON.stringify({ notes: notes }),
      'application/json',
      'J' + baseName + '_notes.json'
    );
    folder.createFile(notesBlob);

    return _json({ ok: true, id: file.getId(), name: file.getName(),
                   url: file.getUrl(), size: bytes.length });
  } catch (err) {
    return _json({ ok: false, error: 'server: ' + (err && err.message || String(err)) });
  }
}

// ===========================================================================
// === Shared: read expense_summary.json =====================================
// ===========================================================================

function readExpenseSummary() {
  var folder = DriveApp.getFolderById(OUTPUT_FOLDER_ID);
  var files  = folder.getFilesByName('expense_summary.json');
  var bestFile = null, bestDate = null;
  while (files.hasNext()) {
    var f = files.next();
    var d = f.getLastUpdated();
    if (!bestFile || d > bestDate) { bestFile = f; bestDate = d; }
  }
  if (!bestFile) return null;
  return JSON.parse(bestFile.getBlob().getDataAsString());
}

// ===========================================================================
// === GET actions (authenticated) ===========================================
// ===========================================================================

function getLastTransaction() {
  var summary;
  try { summary = readExpenseSummary(); }
  catch (err) { return _json({ ok: false, noData: false, error: 'Could not read summary: ' + err.message }); }
  if (!summary) return _json({ ok: false, noData: true,
    error: 'No expense summary yet — generated by Cowork at end of each Task 2 run.' });
  return _json({ ok: true, transaction: summary.lastTransaction });
}

function getTotalAmount() {
  var summary;
  try { summary = readExpenseSummary(); }
  catch (err) { return _json({ ok: false, noData: false, error: 'Could not read summary: ' + err.message }); }
  if (!summary) return _json({ ok: false, noData: true,
    error: 'No expense summary yet — generated by Cowork at end of each Task 2 run.' });
  return _json({ ok: true, totalAmount: summary.totalAmount,
                 receiptCount: summary.receiptCount, updatedAt: summary.updatedAt });
}

// ===========================================================================
// === GET action: download a file from ReceiptInbox =========================
// ===========================================================================

function downloadFile(id) {
  if (!id) return _json({ ok: false, error: 'missing id' });
  try {
    var file = DriveApp.getFileById(id);

    // Security guard: only serve files that live in TARGET_FOLDER_ID (ReceiptInbox).
    // This prevents the endpoint from being used to fetch arbitrary Drive files.
    var parents = file.getParents();
    var inInbox = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === TARGET_FOLDER_ID) { inInbox = true; break; }
    }
    if (!inInbox) return _json({ ok: false, error: 'file not in ReceiptInbox' });

    var blob    = file.getBlob();
    var b64     = Utilities.base64Encode(blob.getBytes());
    return _json({ ok: true, name: file.getName(), content: b64 });
  } catch (err) {
    return _json({ ok: false, error: 'download failed: ' + (err && err.message || String(err)) });
  }
}

// ===========================================================================
// === Utility ===============================================================
// ===========================================================================

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
