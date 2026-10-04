// Builds a static, crawlable page for every product and collection (p/<id>/, c/<category>/) plus sitemap.xml,
// so search engines can index what the shop sells. The store itself still runs from index.html.
// Usage: node tools/seo/build.mjs            (reads the products from Supabase)
//        node tools/seo/build.mjs data.json  (reads them from a local file, for testing)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SITE = 'https://hanagalleryy.ir';
const IG = 'https://instagram.com/hana_gallery_____';

const CATS = {
  necklace: { label: 'گردنبند', plural: 'گردنبندها', intro: 'گردنبندهای دست‌ساز حنا گالری؛ از چوکرهای منجوقی و صدفی تا گردنبندهای مروارید و پلاک استیل با رنگ ثابت. هر مدل در تعداد محدود ساخته می‌شه تا خاص بمونه.' },
  bracelet: { label: 'دستبند', plural: 'دستبندها', intro: 'دستبندها و بنگل‌های حنا گالری؛ استیل با آبکاری طلا و نقره، دستبندهای صدفی و نخی، مناسب استفاده‌ی هر روز و ست کردن با هم.' },
  earring: { label: 'گوشواره', plural: 'گوشواره‌ها', intro: 'گوشواره‌های حنا گالری؛ مدل‌های سنگی، مروارید، اشکی و ایرکاف، تکی یا پک، برای استایل روزمره و مهمونی.' },
  ring: { label: 'انگشتر', plural: 'انگشترها', intro: 'انگشترهای استیل حنا گالری با آبکاری طلا و نقره و نگین‌های ظریف؛ رنگ ثابت و مناسب استفاده‌ی همیشگی.' },
  anklet: { label: 'پابند', plural: 'پابندها', intro: 'پابندهای دست‌ساز حنا گالری؛ ستاره، صدف، دم وال و چشم نظر با منجوق‌های رنگی، سبک و تابستونی.' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const money = (n) => fa(Math.round(Number(n)).toLocaleString('en-US'));
const plain = (s) => String(s || '').replace(/\p{Extended_Pictographic}|️/gu, '').replace(/\s+/g, ' ').trim();
const IMG_FULL = '/storage/v1/object/public/image/products/', IMG_THUMB = '/storage/v1/object/public/image/thumbs/';
const thumb = (u) => (u.includes(IMG_FULL) ? u.replace(IMG_FULL, IMG_THUMB) : u);

async function loadProducts() {
  const file = process.argv[2];
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const url = html.match(/const SUPABASE_URL = '([^']+)'/)[1];
  const key = html.match(/const SUPABASE_KEY = '([^']+)'/)[1];
  const res = await fetch(`${url}/rest/v1/products?select=*&order=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error('products: HTTP ' + res.status);
  return res.json();
}

function normalize(p) {
  const now = Date.now();
  const saleOpen = (!p.sale_starts_at || new Date(p.sale_starts_at).getTime() <= now) && (!p.sale_ends_at || new Date(p.sale_ends_at).getTime() > now);
  const sale = saleOpen && Number(p.sale_price) > 0 && Number(p.sale_price) < Number(p.price) ? Number(p.sale_price) : null;
  const images = String(p.image_url || '').split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  const variants = String(p.variants || '').split(/[,،]/).map((v) => v.trim()).filter(Boolean).map((v) => {
    const [name, qty, price] = v.split(':').map((x) => (x || '').trim());
    const q = qty === 'ناموجود' ? 0 : qty === '' || qty === undefined ? null : parseInt(qty, 10);
    return { name, available: q === null || isNaN(q) || q > 0, price: Number(price) > 0 ? Number(price) : null };
  });
  const cat = String(p.category || '').trim().toLowerCase();
  return {
    id: p.id, name: plain(p.name), cat, catLabel: (CATS[cat] || {}).label || p.category_label || 'محصولات',
    price: Number(p.price), sale, now: sale ?? Number(p.price), stock: Number(p.stock) || 0,
    images, variants, description: String(p.description || '').trim(),
    updated: (p.updated_at || p.created_at || new Date().toISOString()).slice(0, 10),
  };
}

const MARK = `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M22 20H46V21.4C41 21.6 38 23 38 26V94C38 97 41 98.4 46 98.6V100H22V98.6C27 98.4 30 97 30 94V26C30 23 27 21.6 22 21.4Z" fill="#3A2F26"/><path d="M98 20H74V21.4C79 21.6 82 23 82 26V94C82 97 79 98.4 74 98.6V100H98V98.6C93 98.4 90 97 90 94V26C90 23 93 21.6 98 21.4Z" fill="#3A2F26"/><path d="M38 50Q60 72 82 50" stroke="#A9855E" stroke-width=".9" fill="none"/><circle cx="60" cy="63.1" r="1.7" stroke="#A9855E" fill="none"/><path d="M60 65C63.5 69.6 66.5 73.3 66.5 77 66.5 80.8 63.6 83.5 60 83.5 56.4 83.5 53.5 80.8 53.5 77 53.5 73.3 56.5 69.6 60 65Z" fill="#A9855E"/></svg>`;

function shell({ title, description, canonical, image, jsonld, body }) {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="حنا گالری">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image || SITE + '/og-image.jpg')}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500&family=Vazirmatn:wght@400;500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/seo.css">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
</head>
<body>
<header class="top"><a class="brand" href="/" aria-label="حنا گالری">${MARK}<span>HANA GALLERY</span></a><a class="shop" href="/">ورود به فروشگاه</a></header>
<main class="wrap">
${body}
</main>
<footer class="foot"><div class="wrap">
  <nav aria-label="کالکشن‌ها">${Object.entries(CATS).map(([k, c]) => `<a href="/c/${k}/">${c.plural}</a>`).join('')}</nav>
  <p>حنا گالری؛ زیورآلات دست‌ساز با ارسال به سراسر ایران · <a href="${IG}" rel="noopener">اینستاگرام @hana_gallery_____</a></p>
</div></footer>
</body>
</html>
`;
}

function priceHtml(p) {
  return p.sale !== null
    ? `<span class="now">${money(p.sale)} <small>تومان</small></span><s>${money(p.price)}</s><span class="off">${fa(Math.round((1 - p.sale / p.price) * 100))}٪ تخفیف</span>`
    : `<span class="now">${money(p.price)} <small>تومان</small></span>`;
}

function card(p) {
  return `<a class="card" href="/p/${p.id}/">
    <span class="ph">${p.images[0] ? `<img src="${esc(thumb(p.images[0]))}" alt="${esc(p.name)}" loading="lazy" decoding="async" width="400" height="500">` : ''}${p.stock === 0 ? '<i>ناموجود</i>' : p.sale !== null ? '<i class="s">تخفیف</i>' : ''}</span>
    <span class="nm">${esc(p.name)}</span><span class="pr">${priceHtml(p)}</span></a>`;
}

function crumbs(items) {
  return {
    html: `<nav class="crumbs" aria-label="مسیر">${items.map((it, i) => (i < items.length - 1 ? `<a href="${it.url.replace(SITE, '')}">${esc(it.name)}</a><span>›</span>` : `<span aria-current="page">${esc(it.name)}</span>`)).join('')}</nav>`,
    ld: { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })) },
  };
}

function productPage(p, all) {
  const url = `${SITE}/p/${p.id}/`;
  const cat = CATS[p.cat];
  const bc = crumbs([{ name: 'حنا گالری', url: SITE + '/' }, ...(cat ? [{ name: cat.plural, url: `${SITE}/c/${p.cat}/` }] : []), { name: p.name, url }]);
  const descLines = p.description.split('\n').map((l) => plain(l.replace(/^[-•]\s*/, ''))).filter(Boolean);
  const metaDesc = `${p.name} دست‌ساز از حنا گالری، ${p.stock > 0 ? `قیمت ${money(p.now)} تومان` : 'فعلاً ناموجود'}. ${descLines.slice(0, 2).join('، ')}${descLines.length ? '. ' : ''}خرید آنلاین با پرداخت امن و ارسال به سراسر ایران.`;
  const offerPrices = [p.now, ...p.variants.map((v) => v.price).filter(Boolean)];
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: String(p.id), url,
    image: p.images, description: descLines.join('. ') || `${p.name} دست‌ساز حنا گالری`,
    brand: { '@type': 'Brand', name: 'Hana Gallery' }, category: p.catLabel,
    offers: {
      '@type': offerPrices.length > 1 && Math.min(...offerPrices) !== Math.max(...offerPrices) ? 'AggregateOffer' : 'Offer',
      priceCurrency: 'IRR', url,
      ...(offerPrices.length > 1 && Math.min(...offerPrices) !== Math.max(...offerPrices)
        ? { lowPrice: Math.min(...offerPrices) * 10, highPrice: Math.max(...offerPrices) * 10, offerCount: p.variants.length }
        : { price: p.now * 10 }),
      availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: 'حنا گالری' },
    },
  };
  const related = all.filter((x) => x.cat === p.cat && x.id !== p.id).sort((a, b) => (b.stock > 0) - (a.stock > 0) || b.id - a.id).slice(0, 6);
  const body = `${bc.html}
<article class="pdp">
  <div class="gal">${p.images.map((src, i) => `<img src="${esc(src)}" alt="${esc(p.name)}${p.images.length > 1 ? ` - عکس ${fa(i + 1)}` : ''}" ${i ? 'loading="lazy" ' : 'fetchpriority="high" '}decoding="async" width="800" height="1000">`).join('')}</div>
  <div class="info">
    <a class="cat" href="/c/${esc(p.cat)}/">${esc(p.catLabel)}</a>
    <h1>${esc(p.name)}</h1>
    <div class="price">${priceHtml(p)}</div>
    <p class="stock ${p.stock > 0 ? 'in' : 'out'}">${p.stock > 0 ? (p.stock <= 2 ? `فقط ${fa(p.stock)} عدد باقی مونده` : 'موجود') : 'ناموجود'}</p>
    ${p.variants.length ? `<div class="vars"><b>مدل‌ها:</b>${p.variants.map((v) => `<span class="${v.available ? '' : 'na'}">${esc(v.name)}${v.price ? ` · ${money(v.price)}` : ''}</span>`).join('')}</div>` : ''}
    <a class="buy" href="/#p${p.id}">${p.stock > 0 ? 'خرید از فروشگاه' : 'مشاهده در فروشگاه'}</a>
    ${descLines.length ? `<section class="desc"><h2>توضیحات</h2><ul>${descLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>` : ''}
    <ul class="trust"><li>ساخت دست، تولید محدود</li><li>ارسال به سراسر ایران</li><li>پرداخت امن آنلاین</li></ul>
  </div>
</article>
${related.length ? `<section class="more"><h2>${esc(cat ? cat.plural : 'محصولات')}ی دیگه</h2><div class="grid">${related.map(card).join('')}</div><a class="all" href="/c/${esc(p.cat)}/">دیدن همه‌ی ${esc(cat ? cat.plural : 'محصولات')}</a></section>` : ''}`;
  return shell({ title: `${p.name} | خرید ${p.catLabel} دست‌ساز - حنا گالری`, description: metaDesc, canonical: url, image: p.images[0], jsonld: [ld, bc.ld], body });
}

function categoryPage(key, items) {
  const c = CATS[key], url = `${SITE}/c/${key}/`;
  const bc = crumbs([{ name: 'حنا گالری', url: SITE + '/' }, { name: c.plural, url }]);
  const sorted = [...items].sort((a, b) => (b.stock > 0) - (a.stock > 0) || b.id - a.id);
  const prices = items.map((p) => p.now);
  const ld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${c.plural} دست‌ساز حنا گالری`, url, description: c.intro,
    mainEntity: { '@type': 'ItemList', numberOfItems: sorted.length, itemListElement: sorted.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/p/${p.id}/`, name: p.name })) } };
  const body = `${bc.html}
<section class="cat-head"><h1>خرید ${esc(c.label)} دست‌ساز</h1><p>${esc(c.intro)}</p>
  <p class="meta">${fa(sorted.length)} مدل${prices.length ? ` · از ${money(Math.min(...prices))} تا ${money(Math.max(...prices))} تومان` : ''}</p></section>
<div class="grid">${sorted.map(card).join('')}</div>
<nav class="other">${Object.entries(CATS).filter(([k]) => k !== key).map(([k, x]) => `<a href="/c/${k}/">${x.plural}</a>`).join('')}</nav>`;
  return shell({ title: `خرید ${c.label} دست‌ساز | ${c.plural}ی حنا گالری`, description: `${c.intro} ${fa(sorted.length)} مدل با قیمت مناسب و ارسال به سراسر ایران.`, canonical: url, image: sorted[0] && sorted[0].images[0], jsonld: [ld, bc.ld], body });
}

function write(rel, content) {
  const f = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

const products = (await loadProducts()).map(normalize).filter((p) => p.name);
if (products.length < 1) throw new Error('no products, refusing to wipe the pages');
for (const d of ['p', 'c']) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
for (const p of products) write(`p/${p.id}/index.html`, productPage(p, products));
const cats = Object.keys(CATS).filter((k) => products.some((p) => p.cat === k));
for (const k of cats) write(`c/${k}/index.html`, categoryPage(k, products.filter((p) => p.cat === k)));

const today = products.map((p) => p.updated).sort().pop(); // newest product change, so the sitemap only changes when the shop does
const urls = [{ loc: SITE + '/', mod: today, pr: '1.0' }, ...cats.map((k) => ({ loc: `${SITE}/c/${k}/`, mod: today, pr: '0.8' })), ...products.map((p) => ({ loc: `${SITE}/p/${p.id}/`, mod: p.updated, pr: '0.6' }))];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.mod}</lastmod><priority>${u.pr}</priority></url>`).join('\n')}\n</urlset>\n`);
console.log(`built ${products.length} product pages, ${cats.length} collection pages`);
