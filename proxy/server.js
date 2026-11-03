// Iranian relay for the store's Supabase project: visitors in Iran reach this server, which passes every request
// (data, photos, sign-in, payments, live updates) on to Supabase. No dependencies; runs on Node 18+.
'use strict';
const http = require('http');
const https = require('https');
const tls = require('tls');

const TARGET = new URL(process.env.TARGET || 'https://goykyskctygnciwttfqj.supabase.co');
const PORT = Number(process.env.PORT) || 3000;
const lib = TARGET.protocol === 'http:' ? http : https;
const targetPort = Number(TARGET.port) || (TARGET.protocol === 'http:' ? 80 : 443);
const agent = new lib.Agent({ keepAlive: true, maxSockets: 64 });

// headers that describe this hop, not the request
const HOP = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);

function forwardHeaders(req) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) h[k] = v;
  h.host = TARGET.host;
  const ip = req.socket.remoteAddress || '';
  h['x-forwarded-for'] = req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${ip}` : ip;
  h['x-forwarded-host'] = req.headers.host || '';
  h['x-forwarded-proto'] = 'https';
  return h;
}

const server = http.createServer((req, res) => {
  if (req.url === '/__relay/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  const up = lib.request({ host: TARGET.hostname, port: targetPort, method: req.method, path: req.url,
    headers: forwardHeaders(req), agent, servername: TARGET.hostname, timeout: 60000 }, (r) => {
    const h = { ...r.headers };
    delete h.connection; delete h['transfer-encoding'];
    res.writeHead(r.statusCode || 502, h);
    r.pipe(res);
  });
  up.on('timeout', () => up.destroy(new Error('upstream timeout')));
  up.on('error', (e) => {
    if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); }
    res.end(JSON.stringify({ message: 'relay: Supabase unreachable', detail: e.message }));
  });
  req.pipe(up);
});

// live updates (Supabase Realtime) use WebSockets: pass the upgrade through as a raw tunnel
server.on('upgrade', (req, socket, head) => {
  const connect = TARGET.protocol === 'http:'
    ? (cb) => require('net').connect(targetPort, TARGET.hostname, cb)
    : (cb) => tls.connect({ host: TARGET.hostname, port: targetPort, servername: TARGET.hostname }, cb);
  const up = connect(() => {
    const h = forwardHeaders(req);
    h.connection = 'Upgrade'; h.upgrade = req.headers.upgrade || 'websocket';
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(h)) raw += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`;
    up.write(raw + '\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  const close = () => { up.destroy(); socket.destroy(); };
  up.on('error', close); socket.on('error', close);
});

server.keepAliveTimeout = 65000;
server.listen(PORT, () => console.log(`relay on :${PORT} -> ${TARGET.origin}`));
