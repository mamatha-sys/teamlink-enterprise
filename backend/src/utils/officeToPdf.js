// ---------------------------------------------------------------------------
// WORD / EXCEL / POWERPOINT -> PDF for the LMS viewer (founder 2026-11-02: "word, pdf anni document format upload cheyochu", and earlier
// "open document antey akkade open avali, download avakudadhu"). No browser can show an Office file inside a page, so the server turns
// it into a PDF once, and the learner sees that PDF in the in-app viewer (pdf.js, view-only) like any other PDF.
//
// The converter is LibreOffice ("soffice --headless --convert-to pdf"), found from SOFFICE_PATH, then soffice / libreoffice on the PATH,
// then the usual Windows install folder. Each run gets its own throw-away profile folder, so two conversions never lock each other.
// Not installed: available() is false and the Office file is kept as it is; it is converted the first time it is opened after the
// converter is installed (routes/lms.js). Live: install-office-converter-on-vps.ps1.
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const OFFICE_MIMES = new Set([
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const isOffice = (mime) => OFFICE_MIMES.has(String(mime || ''));

let found; // undefined = not looked yet, null = none
let lookedAt = 0;
function binary() {
  // "none" is looked at again after 5 minutes, so installing LibreOffice while TeamLink runs needs no restart
  if (found !== undefined && (found || Date.now() - lookedAt < 5 * 60 * 1000)) return found;
  lookedAt = Date.now();
  const tries = [process.env.SOFFICE_PATH, 'soffice', 'libreoffice', 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'].filter(Boolean);
  found = null;
  for (const b of tries) { // eslint-disable-line no-restricted-syntax
    try { execFileSync(b, ['--version'], { stdio: 'ignore', timeout: 20000, windowsHide: true }); found = b; break; } catch { /* next */ }
  }
  return found;
}
const available = () => !!binary();
// look again (after the converter was installed while the server runs)
const reset = () => { found = undefined; };

// input file -> a PDF file next to it in a temp folder. Resolves to the PDF's path; rejects on failure or after 3 minutes.
function convert(inputPath, ext) {
  const bin = binary();
  if (!bin) return Promise.reject(new Error('NO_CONVERTER'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-office-'));
  const src = path.join(work, `in.${ext || 'docx'}`);
  fs.copyFileSync(inputPath, src);
  const profile = `file:///${path.join(work, 'profile').split(path.sep).join('/').replace(/^\/+/, '')}`;
  return new Promise((resolve, reject) => {
    execFile(bin, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', work, src], { timeout: 180000, windowsHide: true }, (err) => {
      const out = path.join(work, 'in.pdf');
      if (err || !fs.existsSync(out) || !fs.statSync(out).size) {
        fs.rmSync(work, { recursive: true, force: true });
        reject(new Error('CONVERT_FAILED'));
        return;
      }
      resolve({ pdf: out, cleanup: () => fs.rmSync(work, { recursive: true, force: true }) });
    });
  });
}

module.exports = { isOffice, available, reset, convert, OFFICE_MIMES };
