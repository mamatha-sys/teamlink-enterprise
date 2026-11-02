// ---------------------------------------------------------------------------
// X (TWITTER) WITH THE APP'S PERMANENT KEYS (founder 2026-11-02: "x kuda automatic cheyyi" - every integration typed in TeamLink
// Administration must reach Omni-Channel by itself).
//
// The four values from developer.x.com > your app > Keys and tokens (OAuth 1.0a): API Key, API Key Secret, Access Token, Access Token
// Secret. They do not expire (unlike X's two-hour OAuth 2.0 tokens), so once pasted in Administration > Integrations > Social Media > X
// they keep working, and utils/greenStartIntegrations.js gives the same account to Omni-Channel (Green Start POST /social/twitter/
// connect-keys). They are checked here with X itself (GET /2/users/me) before they are kept; stored encrypted (utils/secrets.js), never
// sent to a screen.
// ---------------------------------------------------------------------------
const crypto = require('crypto');

const apiBase = () => String(process.env.TL_X_API_BASE || 'https://api.x.com/2').replace(/\/+$/, '');
const FIELDS = ['apiKey', 'apiSecret', 'accessToken', 'accessSecret'];
const LABELS = { apiKey: 'API Key', apiSecret: 'API Key Secret', accessToken: 'Access Token', accessSecret: 'Access Token Secret' };

// The four keys, trimmed, or { error, field }.
function readKeys(body = {}) {
  const k = {};
  for (const f of FIELDS) {
    const v = String(body[f] == null ? '' : body[f]).trim();
    if (v.length < 10 || /\s/.test(v)) return { error: `That does not look like the X ${LABELS[f]}. Copy it again from developer.x.com > your app > Keys and tokens.`, field: f };
    k[f] = v;
  }
  return { keys: k };
}

// RFC 3986 encoding as OAuth 1.0a needs it
const enc = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// The "Authorization: OAuth ..." header for one request. params = extra signed parameters (form fields); nonce / timestamp for tests.
function oauth1Header(keys, method, url, params = {}, fixed = {}) {
  const u = new URL(url);
  const query = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });
  const oauth = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: fixed.nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: fixed.timestamp || String(Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: '1.0',
  };
  const pairs = Object.entries({ ...query, ...params, ...oauth }).map(([k, v]) => [enc(k), enc(v)]);
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : (a[0] < b[0] ? -1 : 1)));
  const base = `${method.toUpperCase()}&${enc(`${u.origin}${u.pathname}`)}&${enc(pairs.map(([k, v]) => `${k}=${v}`).join('&'))}`;
  const signature = crypto.createHmac('sha1', `${enc(keys.apiSecret)}&${enc(keys.accessSecret)}`).update(base).digest('base64');
  const header = { ...oauth, oauth_signature: signature };
  return `OAuth ${Object.keys(header).sort().map((k) => `${enc(k)}="${enc(header[k])}"`).join(', ')}`;
}

// Ask X which account these keys post as: { id, username, name } or throws with X's own words (never a key).
async function whoAmI(keys) {
  const url = `${apiBase()}/users/me?user.fields=username,name`;
  let res;
  try { res = await fetch(url, { headers: { Authorization: oauth1Header(keys, 'GET', url) }, signal: AbortSignal.timeout(20000) }); } catch { throw new Error('X could not be reached from this server'); }
  const j = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error('X says too many requests - try again in a few minutes');
  if (!res.ok || !j.data || !j.data.id) {
    const said = j.detail || j.title || (Array.isArray(j.errors) && j.errors[0] && (j.errors[0].message || j.errors[0].detail)) || `HTTP ${res.status}`;
    throw new Error(String(said).slice(0, 200));
  }
  return { id: String(j.data.id), username: j.data.username || null, name: j.data.name || null };
}

module.exports = { readKeys, oauth1Header, whoAmI, FIELDS, LABELS };
