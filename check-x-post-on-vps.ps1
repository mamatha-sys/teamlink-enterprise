# ---------------------------------------------------------------------------
# "X connect ayyindi kani post fail" (X refused to publish) - check of the live server. 2026-11-05.
#
#   .\check-x-post-on-vps.ps1
#
# Green Start shows one message for HTTP 402 and 403 and keeps X's own reason nowhere, so this asks X directly
# with the default X account of Social Media > X.
#
# NOTHING IS POSTED: the two write calls are sent EMPTY (no text, no file), and X cannot publish an empty post.
# Never prints a key. It shows:
#   1. GET  /2/users/me      - which account the keys post as (are the keys still valid?)
#   2. POST /2/tweets        - empty body. 400 = posting allowed. 402 / 403 = X refuses, with X's own reason.
#   3. POST /2/media/upload  - empty form. Same reading, for photos.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$VpsHost = 'root@72.61.233.104'

$script = @'
set -euo pipefail
cd /opt/teamlink-enterprise/backend
node - <<"EOF_NODE"
require("dotenv").config();
const SA = require("./src/utils/socialAccounts");
const XK = require("./src/utils/xKeys");
const API = "https://api.x.com/2";
const said = (j) => {
  const e = Array.isArray(j.errors) && j.errors[0] ? j.errors[0] : {};
  return [j.title, j.type, j.detail, j.reason, e.message, e.title, e.detail].filter(Boolean).join(" | ").slice(0, 300) || "(X gave no words)";
};
async function ask(label, method, url, headers, body) {
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
  const j = await res.json().catch(() => ({}));
  console.log(`  ${label}: HTTP ${res.status} - ${said(j)}`);
  return { status: res.status, j };
}
const reading = (name, s) => {
  if (s === 400) return `  => ${name}: ALLOWED (X only complained that it was empty, as expected).`;
  if (s === 402) return `  => ${name}: REFUSED - no credits or the plan does not cover this. Add credits / change plan in the X developer console.`;
  if (s === 403) return `  => ${name}: REFUSED - read X's words above.`;
  if (s === 401) return `  => ${name}: the keys were refused - paste the newest keys in Social Media > X.`;
  if (s === 429) return `  => ${name}: X limit reached - try later.`;
  return `  => ${name}: unexpected answer - send these lines to Claude.`;
};
(async () => {
  const d = await SA.defaultXKeys();
  if (!d) { console.log("No default X account in Social Media > X."); process.exit(0); }
  console.log(`== default X account in TeamLink: ${d.name}`);
  const k = d.keys;
  const me = await ask("1. who am I", "GET", `${API}/users/me?user.fields=username`, { Authorization: XK.oauth1Header(k, "GET", `${API}/users/me?user.fields=username`) });
  if (me.status === 200) console.log(`  => keys work, posting as @${me.j.data && me.j.data.username}`);
  else console.log(reading("keys", me.status));
  const t = await ask("2. post (empty, nothing is published)", "POST", `${API}/tweets`, { Authorization: XK.oauth1Header(k, "POST", `${API}/tweets`), "Content-Type": "application/json" }, "{}");
  console.log(reading("text post", t.status));
  const m = await ask("3. photo upload (empty, no file)", "POST", `${API}/media/upload`, { Authorization: XK.oauth1Header(k, "POST", `${API}/media/upload`) }, new FormData());
  console.log(reading("photo upload", m.status));
  process.exit(0);
})().catch((e) => { console.log("  could not finish: " + String(e.message).slice(0, 200)); process.exit(0); });
EOF_NODE
'@
$script = $script.Replace("`r", '')
# tr on the server: PowerShell ends piped text with a Windows line end, which bash would read as a command
$script | ssh $VpsHost 'tr -d ''\r'' | bash -s'
if ($LASTEXITCODE -ne 0) { throw 'The check could not run (see the lines above).' }
