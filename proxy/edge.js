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

// Arvan's CDN does not cache what this script returns (x-cache: BYPASS), so every visit used to go all the way to
// Supabase in Europe. Static files, product photos and (briefly) pages are now kept here, at the edge, in Iran:
// in the edge's own cache where it has one, and in memory otherwise. Pages are served from the copy and refreshed
// in the background, so a deploy shows up within about a minute.
const MEM = new Map(); let memBytes = 0; const MEM_MAX = 48 * 1024 * 1024;
const edgeCache = (() => { try { return typeof caches !== 'undefined' && caches.default ? caches.default : null; } catch (e) { return null; } })();
function ttlFor(kind, path) {
  if (kind === 'img') return 30 * 86400;
  if (/^\/(assets|fonts|vendor)\//.test(path)) return 7 * 86400;
  if (/\.(html|xml|txt|webmanifest)$/.test(path) || path.endsWith('/') || !(path.split('/').pop() || '').includes('.')) return 60;
  return 86400;
}
async function cached(event, key, kind, path, load) {
  const now = Date.now(), ttl = ttlFor(kind, path) * 1000;
  let hit = MEM.get(key);
  if (!hit && edgeCache) {
    try { const r = await edgeCache.match(key); if (r) { hit = { status: r.status, headers: [...r.headers], body: await r.arrayBuffer(), at: Number(r.headers.get('x-hg-at')) || now }; } } catch (e) {}
  }
  const store = async () => {
    const r = await load();
    if (r.status !== 200) return r;
    const body = await r.arrayBuffer();
    const headers = [...r.headers].filter(([k]) => k !== 'x-hg-at');
    const item = { status: 200, headers, body, at: Date.now() };
    if (body.byteLength < 4 * 1024 * 1024) {
      const old = MEM.get(key); if (old) memBytes -= old.body.byteLength;
      MEM.delete(key); MEM.set(key, item); memBytes += body.byteLength;
      for (const [k, v] of MEM) { if (memBytes <= MEM_MAX) break; MEM.delete(k); memBytes -= v.body.byteLength; }
      if (edgeCache) { try { await edgeCache.put(key, new Response(body.slice(0), { headers: [...headers, ['x-hg-at', String(item.at)], ['cache-control', 'public, max-age=' + Math.round(ttl / 1000 + 86400)]] })); } catch (e) {} }
    }
    return new Response(body, { status: 200, headers: [...headers, ['x-hg-cache', 'MISS']] });
  };
  if (hit) {
    MEM.delete(key); MEM.set(key, hit);
    const age = now - hit.at;
    // fresh: serve it; a page a little out of date: serve it and fetch the new one in the background
    if (age < ttl || (kind === 'site' && age < 86400e3)) {
      if (age >= ttl) { const job = store().catch(() => {}); try { event.waitUntil(job); } catch (e) {} }
      return new Response(hit.body, { status: hit.status, headers: [...hit.headers, ['x-hg-cache', age < ttl ? 'HIT' : 'STALE']] });
    }
  }
  return store();
}

async function site(request, url, event) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const load = async () => {
    const r = await fetch(TARGET + '/functions/v1/site' + url.pathname + url.search, { method: 'GET', redirect: 'manual' });
    const out = new Headers();
    for (const k of ['cache-control', 'location']) { const v = r.headers.get(k); if (v) out.set(k, v); }
    out.set('content-type', typeOf(url.pathname, r.status));
    return new Response(r.body, { status: r.status, headers: out });
  };
  try {
    // ?pay=1 (back from the bank) and other query strings on pages still go through, uncached
    const r = request.method === 'GET' && (!url.search || /^\/(assets|fonts|vendor)\//.test(url.pathname))
      ? await cached(event, 'https://hanagalleryy.ir' + url.pathname + url.search, 'site', url.pathname, load) : await load();
    return request.method === 'HEAD' ? new Response(null, { status: r.status, headers: r.headers }) : r;
  } catch (e) {
    return new Response('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;text-align:center;margin-top:20vh">سایت موقتاً در دسترس نیست. چند دقیقه دیگه دوباره امتحان کنید.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
}

async function handle(request, event) {
  const url = new URL(request.url);
  if (url.hostname !== 'api.hanagalleryy.ir') return site(request, url, event);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  if (url.pathname === '/__relay/health') return new Response('ok', { headers: { 'content-type': 'text/plain', ...cors(request) } });
  const headers = new Headers(request.headers);
  for (const h of ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'origin', 'referer']) headers.delete(h);
  // the visitor's own address, for the «geo» check (Supabase otherwise sees this edge server's address)
  const ip = request.headers.get('ar-real-ip') || request.headers.get('x-real-ip') || request.headers.get('true-client-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (ip) headers.set('x-hg-client-ip', ip);
  // product photos never change under the same name: keep them here for a month
  if (request.method === 'GET' && /^\/storage\/v1\/(object|render\/image)\/public\//.test(url.pathname)) {
    try {
      const r = await cached(event, 'https://api.hanagalleryy.ir' + url.pathname + url.search, 'img', url.pathname, async () => {
        const res = await fetch(TARGET + url.pathname + url.search);
        const out = new Headers();
        for (const k of ['content-type', 'etag', 'last-modified']) { const v = res.headers.get(k); if (v) out.set(k, v); }
        out.set('cache-control', 'public, max-age=2592000, immutable');
        return new Response(res.body, { status: res.status, headers: out });
      });
      const out = new Headers(r.headers);
      for (const [k, v] of Object.entries(cors(request))) out.set(k, v);
      return new Response(r.body, { status: r.status, headers: out });
    } catch (e) { /* fall through to the plain relay */ }
  }
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

addEventListener('fetch', (event) => event.respondWith(handle(event.request, event)));
