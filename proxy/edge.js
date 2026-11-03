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

async function handle(request) {
  const url = new URL(request.url);
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
