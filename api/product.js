// Reads a product page's public metadata (title, description, price, main image) for the buy-check.
// Signed-in users only. SSRF guards: https only, default port, public IPs only, redirects re-checked, size and time caps.
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (compatible; FitCheckBot/1.0; product metadata preview)';
const fail = (res, status, code) => res.status(status).json({ code });

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const s = ip.toLowerCase();
  return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s.startsWith('::ffff:');
}

async function safeFetch(raw, accept, maxBytes, truncateOk) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.port || u.username || u.password) throw new Error('blocked url');
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, ''))) throw new Error('blocked host');
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some(a => isPrivate(a.address))) throw new Error('blocked address');
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'user-agent': UA, accept, 'accept-language': 'en-US,en;q=0.8' } });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location'); if (!loc) throw new Error('bad redirect');
      url = new URL(loc, u).href; continue;
    }
    if (!r.ok) throw new Error('status ' + r.status);
    const reader = r.body.getReader(); const chunks = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > maxBytes) { await reader.cancel().catch(() => {}); if (!truncateOk) throw new Error('too large'); chunks.push(value.subarray(0, value.length - (total - maxBytes))); break; }
      chunks.push(value);
    }
    return { buf: Buffer.concat(chunks), type: (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), url: u.href };
  }
  throw new Error('too many redirects');
}

const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
function meta(html, keys) {
  for (const k of keys) {
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*?content=["']([^"']*)["']`, 'i');
    const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${k}["']`, 'i');
    const m = html.match(a) || html.match(b);
    if (m && m[1].trim()) return decode(m[1]);
  }
  return '';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed');
  const env = k => (process.env[k] || '').trim();
  let SUPABASE_URL = ''; try { SUPABASE_URL = new URL(env('SUPABASE_URL')).origin; } catch (e) {}
  const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY');
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return fail(res, 503, 'not_configured');
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'session_expired');
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!r.ok) return fail(res, 401, 'session_expired');
  } catch (e) { return fail(res, 502, 'upstream_error'); }

  const url = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
  if (!url || url.length > 2000) return fail(res, 400, 'invalid_request');

  let page;
  try { page = await safeFetch(url, 'text/html,application/xhtml+xml', 700000, true); }
  catch (e) { return fail(res, 422, 'unreadable'); }
  if (page.type && !/html/.test(page.type)) return fail(res, 422, 'unreadable');
  const html = page.buf.toString('utf8');
  const out = {
    site: new URL(page.url).hostname.replace(/^www\./, ''),
    title: (meta(html, ['og:title', 'twitter:title']) || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1])).slice(0, 200),
    description: meta(html, ['og:description', 'description', 'twitter:description']).slice(0, 600),
    price: meta(html, ['product:price:amount', 'og:price:amount']) || ((html.match(/"price"\s*:\s*"?(\d{1,6}(?:\.\d{1,2})?)"?/) || [])[1] || ''),
    image_b64: '', image_type: '',
  };
  const img = meta(html, ['og:image:secure_url', 'og:image', 'twitter:image']);
  if (img) {
    try {
      const im = await safeFetch(new URL(img, page.url).href, 'image/*', 2500000, false);
      if (/^image\/(jpeg|png|webp|gif|avif)$/.test(im.type)) { out.image_b64 = im.buf.toString('base64'); out.image_type = im.type; }
    } catch (e) { /* a page without a fetchable image is still useful */ }
  }
  if (!out.title && !out.image_b64) return fail(res, 422, 'unreadable');
  res.status(200).json(out);
};
