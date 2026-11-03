// Arvan Edge Computing relay for the store's Supabase project (same job as server.js, for the edge).
// Every request is passed on to Supabase with Supabase's own Host, so visitors in Iran reach it without a VPN.
const TARGET = 'https://goykyskctygnciwttfqj.supabase.co';

async function handle(request) {
  const url = new URL(request.url);
  if (url.pathname === '/__relay/health') return new Response('ok', { headers: { 'content-type': 'text/plain' } });
  const headers = new Headers(request.headers);
  for (const h of ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade']) headers.delete(h);
  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  try {
    const r = await fetch(TARGET + url.pathname + url.search, init);
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
  } catch (e) {
    return new Response(JSON.stringify({ message: 'relay: Supabase unreachable', detail: String(e) }),
      { status: 502, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  }
}

addEventListener('fetch', (event) => event.respondWith(handle(event.request)));
