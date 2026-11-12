// A stand-in catalogue for the offline browser checks: real names and prices read from the static
// product pages, placeholder photos. Nothing here touches the live database.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const CAT = { 'گردنبند': 'necklace', 'گوشواره': 'earring', 'دستبند': 'bracelet', 'انگشتر': 'ring', 'پابند': 'anklet', 'اکسسوری مو': 'hair' };
function load(){
  const out = [];
  for (const id of fs.readdirSync(path.join(ROOT, 'p')).filter(x => /^\d+$/.test(x)).sort((a, b) => a - b)) {
    const html = fs.readFileSync(path.join(ROOT, 'p', id, 'index.html'), 'utf8');
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let j; try { j = JSON.parse(m[1]); } catch (e) { continue; }
      for (const it of (Array.isArray(j) ? j : j['@graph'] || [j])) if (it['@type'] === 'Product') out.push({ id: +id, name: it.name, label: it.category, price: Math.round(((it.offers || {}).price || 0) / 10) });
    }
  }
  return out.map((p, i) => ({ id: p.id, name: p.name, category: CAT[p.label] || 'necklace', category_label: p.label, price: p.price || 100000,
    sale_price: i % 7 === 3 ? Math.round(p.price * 0.85) : null, stock: i % 9 === 4 ? 0 : i % 5 === 1 ? 1 : 5, is_new: i > out.length - 10,
    image_url: 'https://goykyskctygnciwttfqj.supabase.co/storage/v1/object/public/image/ph' + p.id + '.jpg', variants: i % 4 === 0 ? 'طلایی:3,نقره‌ای:0' : null, description: 'نمونه' }));
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 750"><rect width="600" height="750" fill="#E6D9C6"/></svg>';
// serve the local copy, fake the catalogue, block everything else
function route(page, prods){
  const H = { 'access-control-allow-origin': '*' };
  return page.route('**/*', r => { const u = r.request().url();
    if (u.startsWith('http://127.0.0.1')) return r.continue();
    if (u.includes('/rest/v1/products')) return r.fulfill({ status: 200, contentType: 'application/json', headers: H, body: JSON.stringify(prods) });
    if (u.includes('/__relay/health')) return r.fulfill({ status: 200, headers: H, body: 'ok' });
    if (/ph\d+\.jpg/.test(u)) return r.fulfill({ status: 200, contentType: 'image/svg+xml', headers: H, body: svg });
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...H, 'access-control-allow-headers': '*' } });
    return r.abort(); });
}
module.exports = { load, route };
