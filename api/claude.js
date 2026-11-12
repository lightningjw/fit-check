// Server-side proxy to the Anthropic API. The API key never reaches the browser.
// Guards, in order: signed-in Supabase user -> optional email allowlist -> size caps -> per-user daily cap.
const MODELS = {
  quick: process.env.MODEL_QUICK || 'claude-haiku-5-5',
  default: process.env.MODEL_DEFAULT || 'claude-sonnet-5-5',
};
const DAILY_CAP = Number(process.env.AI_DAILY_CAP || 40);
const MAX_PROMPT_CHARS = 60000;
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 700000; // ~525 KB decoded

const fail = (res, status, code) => res.status(status).json({ code });

module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed');
  const env = k => (process.env[k] || '').trim();
  let SUPABASE_URL = ''; try { SUPABASE_URL = new URL(env('SUPABASE_URL')).origin; } catch (e) {}   // tolerate a pasted .../rest/v1/ path
  const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY'), SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY'), ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) return fail(res, 503, 'not_configured');

  // 1. Who is calling? Ask Supabase to validate the token rather than trusting it.
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'session_expired');
  let user;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!r.ok) return fail(res, 401, 'session_expired');
    user = await r.json();
  } catch (e) { return fail(res, 502, 'upstream_error'); }
  if (!user || !user.id) return fail(res, 401, 'session_expired');

  // 2. Optional allowlist: ALLOWED_EMAILS="a@x.com,b@y.com". Unset = any signed-in user.
  const allow = (process.env.ALLOWED_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) return fail(res, 403, 'not_allowed');

  // 3. Validate the request before spending anything.
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const images = Array.isArray(body.images) ? body.images : [];
  if (!prompt.trim()) return fail(res, 400, 'invalid_request');
  if (prompt.length > MAX_PROMPT_CHARS || images.length > MAX_IMAGES) return fail(res, 413, 'too_large');
  for (const im of images) {
    if (typeof im !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(im)) return fail(res, 400, 'invalid_request');
    if (im.length > MAX_IMAGE_B64) return fail(res, 413, 'too_large');
  }
  const model = MODELS[body.tier === 'quick' ? 'quick' : 'default'];

  // 4. Atomic per-user daily counter (see supabase/schema.sql). Counts attempts, not successes.
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bump_ai_usage`, {
      method: 'POST',
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_user: user.id, p_cap: DAILY_CAP }),
    });
    if (!r.ok) return fail(res, 503, 'not_configured');
    if ((await r.json()) !== true) return fail(res, 429, 'daily_limit');
  } catch (e) { return fail(res, 502, 'upstream_error'); }

  // 5. Call Claude.
  try {
    const content = images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
    content.push({ type: 'text', text: prompt });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content }] }),
    });
    if (r.status === 429 || r.status === 529) return fail(res, 429, 'rate_limited');
    if (!r.ok) { console.error('anthropic', r.status, (await r.text()).slice(0, 300)); return fail(res, 502, 'upstream_error'); }
    const out = await r.json();
    const text = (out.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text.trim()) return fail(res, 502, 'upstream_error');
    return res.status(200).json({ text });
  } catch (e) { console.error('claude call failed', e && e.message); return fail(res, 502, 'upstream_error'); }
};
