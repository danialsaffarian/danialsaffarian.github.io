// Arvan Edge Computing relay for the store's Supabase project (same job as server.js, for the edge).
// Every request is passed on to Supabase with Supabase's own Host, so visitors in Iran reach it without a VPN.
// CORS is answered here, once: the CDN in between can duplicate or drop Supabase's own CORS headers,
// which makes browsers refuse every request after the preflight.
const TARGET = 'https://goykyskctygnciwttfqj.supabase.co';

function cors(request) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
    'access-control-allow-headers': request.headers.get('access-control-request-headers') || '*',
    'access-control-expose-headers': '*',
    'access-control-max-age': '86400',
  };
}

// hanagalleryy.ir itself: Arvan's link to GitHub Pages keeps timing out, so the pages come from Supabase's «site»
// function, which reads them from the GitHub repo (Arvan reaches Supabase fine)
// Supabase serves every function response as text/plain, so the real type comes from the file name here
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json', xml: 'application/xml; charset=utf-8', txt: 'text/plain; charset=utf-8', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff2: 'font/woff2', woff: 'font/woff', webmanifest: 'application/manifest+json' };
function typeOf(path, status) {
  if (status === 404 || path.endsWith('/')) return TYPES.html;
  const last = path.split('/').pop() || '';
  return last.includes('.') ? (TYPES[last.split('.').pop().toLowerCase()] || 'application/octet-stream') : TYPES.html;
}

async function site(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  try {
    const r = await fetch(TARGET + '/functions/v1/site' + url.pathname + url.search, { method: request.method, redirect: 'manual' });
    const out = new Headers();
    for (const k of ['cache-control', 'location']) { const v = r.headers.get(k); if (v) out.set(k, v); }
    out.set('content-type', typeOf(url.pathname, r.status));
    return new Response(r.body, { status: r.status, headers: out });
  } catch (e) {
    return new Response('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;text-align:center;margin-top:20vh">سایت موقتاً در دسترس نیست. چند دقیقه دیگه دوباره امتحان کنید.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
}

async function handle(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'api.hanagalleryy.ir') return site(request, url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  if (url.pathname === '/__relay/health') return new Response('ok', { headers: { 'content-type': 'text/plain', ...cors(request) } });
  const headers = new Headers(request.headers);
  for (const h of ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'origin', 'referer']) headers.delete(h);
  // the visitor's own address, for the «geo» check (Supabase otherwise sees this edge server's address)
  const ip = request.headers.get('ar-real-ip') || request.headers.get('x-real-ip') || request.headers.get('true-client-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (ip) headers.set('x-hg-client-ip', ip);
  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  try {
    const r = await fetch(TARGET + url.pathname + url.search, init);
    const out = new Headers(r.headers);
    for (const k of [...out.keys()]) if (k.startsWith('access-control-')) out.delete(k);
    for (const [k, v] of Object.entries(cors(request))) out.set(k, v);
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out });
  } catch (e) {
    return new Response(JSON.stringify({ message: 'relay: Supabase unreachable', detail: String(e) }),
      { status: 502, headers: { 'content-type': 'application/json', ...cors(request) } });
  }
}

addEventListener('fetch', (event) => event.respondWith(handle(event.request)));
