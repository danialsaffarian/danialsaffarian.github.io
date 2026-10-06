// Gives every product and collection its own address (p/<id>/, c/<category>/) for search engines, and writes sitemap.xml.
// Each page is the store itself (a copy of index.html) carrying that product's or collection's own title, description,
// image and structured data; once loaded, the store opens that product or collection.
// Usage: node tools/seo/build.mjs            (reads the products from Supabase)
//        node tools/seo/build.mjs data.json  (reads them from a local file, for testing)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SITE = 'https://hanagalleryy.ir';

const CATS = {
  necklace: { label: 'گردنبند', plural: 'گردنبندها', intro: 'گردنبندهای دست‌ساز حنا گالری؛ از چوکرهای منجوقی و صدفی تا گردنبندهای مروارید و پلاک استیل با رنگ ثابت.' },
  bracelet: { label: 'دستبند', plural: 'دستبندها', intro: 'دستبندها و بنگل‌های حنا گالری؛ استیل با آبکاری طلا و نقره، دستبندهای صدفی و نخی، مناسب استفاده‌ی هر روز.' },
  earring: { label: 'گوشواره', plural: 'گوشواره‌ها', intro: 'گوشواره‌های حنا گالری؛ مدل‌های سنگی، مروارید، اشکی و ایرکاف، تکی یا پک، برای استایل روزمره و مهمونی.' },
  ring: { label: 'انگشتر', plural: 'انگشترها', intro: 'انگشترهای استیل حنا گالری با آبکاری طلا و نقره و نگین‌های ظریف؛ رنگ ثابت و مناسب استفاده‌ی همیشگی.' },
  anklet: { label: 'پابند', plural: 'پابندها', intro: 'پابندهای دست‌ساز حنا گالری؛ ستاره، صدف، دم وال و چشم نظر با منجوق‌های رنگی.' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const money = (n) => fa(Math.round(Number(n)).toLocaleString('en-US'));
const plain = (s) => String(s || '').replace(/\p{Extended_Pictographic}|️/gu, '').replace(/\s+/g, ' ').trim();

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

// approved customer reviews only: they become the product's rating in search results; without a review there is none
async function loadReviews() {
  const file = process.argv[3];
  if (process.argv[2]) return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  try {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const url = html.match(/const SUPABASE_URL = '([^']+)'/)[1];
    const key = html.match(/const SUPABASE_KEY = '([^']+)'/)[1];
    const res = await fetch(`${url}/rest/v1/reviews?select=product_id,author_name,rating,comment,created_at&approved=eq.true&order=created_at.desc`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    return res.ok ? await res.json() : [];
  } catch (e) { console.warn('reviews skipped:', e.message); return []; }
}

function normalize(p) {
  const now = Date.now();
  const saleOpen = (!p.sale_starts_at || new Date(p.sale_starts_at).getTime() <= now) && (!p.sale_ends_at || new Date(p.sale_ends_at).getTime() > now);
  const sale = saleOpen && Number(p.sale_price) > 0 && Number(p.sale_price) < Number(p.price) ? Number(p.sale_price) : null;
  const images = String(p.image_url || '').split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  const variants = String(p.variants || '').split(/[,،]/).map((v) => v.trim()).filter(Boolean).map((v) => {
    const [name, , price] = v.split(':').map((x) => (x || '').trim());
    return { name, price: Number(price) > 0 ? Number(price) : null };
  });
  const cat = String(p.category || '').trim().toLowerCase();
  return {
    id: p.id, name: plain(p.name), cat, catLabel: (CATS[cat] || {}).label || p.category_label || 'محصولات',
    price: Number(p.price), sale, now: sale ?? Number(p.price), stock: Number(p.stock) || 0, images, variants,
    lines: String(p.description || '').split('\n').map((l) => plain(l.replace(/^[-•]\s*/, ''))).filter(Boolean),
    updated: (p.updated_at || p.created_at || new Date().toISOString()).slice(0, 10),
  };
}

// as stated on the store (ارسال، مرجوعی و نگهداری): returns within 48 hours of delivery when the item doesn't match the order
const RETURNS = { '@type': 'MerchantReturnPolicy', applicableCountry: 'IR', returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: 2, returnMethod: 'https://schema.org/ReturnByMail', merchantReturnLink: SITE + '/#shipping' };

const crumbLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })) });

// the store's page with this address's own head; the home page's other structured data (FAQ etc.) stays on the home page only
function storePage(base, { title, description, url, image, jsonld, noscript, meta = '' }) {
  let h = base.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '');
  const set = (re, val) => { if (!re.test(h)) throw new Error('index.html changed: ' + re); h = h.replace(re, val); };
  set(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  set(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  set(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);
  set(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`);
  set(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
  set(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  set(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
  set(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  if (image) {
    set(/(<meta property="og:image" content=")[^"]*(")/, `$1${esc(image)}$2`);
    set(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${esc(image)}$2`);
    h = h.replace(/<meta property="og:image:(width|height)"[^>]*>\s*/g, '');
  }
  if (meta) h = h.replace('</head>', meta + '\n</head>');
  h = h.replace('</head>', `${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}\n</head>`);
  return h.replace(/<body([^>]*)>/, `<body$1>\n<noscript><div style="padding:16px">${noscript}</div></noscript>`);
}

function productPage(base, p, all) {
  const url = `${SITE}/p/${p.id}/`, cat = CATS[p.cat];
  const desc = `${p.name} دست‌ساز از حنا گالری، ${p.stock > 0 ? `قیمت ${money(p.now)} تومان` : 'فعلاً ناموجود'}. ${p.lines.slice(0, 2).join('، ')}${p.lines.length ? '. ' : ''}خرید آنلاین با پرداخت امن و ارسال به سراسر ایران.`;
  const prices = [p.now, ...p.variants.map((v) => v.price).filter(Boolean)];
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const product = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: String(p.id), url, image: p.images,
    description: p.lines.join('. ') || `${p.name} دست‌ساز حنا گالری`, brand: { '@type': 'Brand', name: 'Hana Gallery' }, category: p.catLabel,
    offers: {
      '@type': lo !== hi ? 'AggregateOffer' : 'Offer', priceCurrency: 'IRR', url,
      ...(lo !== hi ? { lowPrice: lo * 10, highPrice: hi * 10, offerCount: p.variants.length } : { price: p.now * 10 }),
      availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition', seller: { '@type': 'Organization', name: 'حنا گالری' },
      hasMerchantReturnPolicy: RETURNS,
    },
  };
  const revs = (p.reviews || []).filter((r) => r.rating >= 1 && r.rating <= 5);
  if (revs.length) {
    product.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number((revs.reduce((s, r) => s + r.rating, 0) / revs.length).toFixed(1)), reviewCount: revs.length, bestRating: 5, worstRating: 1 };
    product.review = revs.slice(0, 5).map((r) => ({ '@type': 'Review', author: { '@type': 'Person', name: plain(r.author_name) || 'مشتری حنا گالری' }, datePublished: String(r.created_at).slice(0, 10),
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 }, ...(plain(r.comment) ? { reviewBody: plain(r.comment) } : {}) }));
  }
  const crumbs = crumbLd([{ name: 'حنا گالری', url: SITE + '/' }, ...(cat ? [{ name: cat.plural, url: `${SITE}/c/${p.cat}/` }] : []), { name: p.name, url }]);
  const others = all.filter((x) => x.cat === p.cat && x.id !== p.id).slice(0, 8);
  const noscript = `<h1>${esc(p.name)}</h1><p>${p.stock > 0 ? `${money(p.now)} تومان` : 'ناموجود'}</p>${p.images[0] ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" width="400">` : ''}${p.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${others.length ? `<p>${others.map((o) => `<a href="/p/${o.id}/">${esc(o.name)}</a>`).join(' · ')}</p>` : ''}`;
  // price-comparison crawlers (ترب و ...) read these; prices in toman
  const meta = [
    `<meta name="product_id" content="${p.id}">`,
    `<meta name="product_name" content="${esc(p.name)}">`,
    `<meta name="product_price" content="${p.now}">`,
    p.sale !== null ? `<meta name="product_old_price" content="${p.price}">` : '',
    `<meta name="availability" content="${p.stock > 0 ? 'instock' : 'outofstock'}">`,
  ].filter(Boolean).join('\n');
  return storePage(base, { title: `${p.name} | خرید ${p.catLabel} دست‌ساز - حنا گالری`, description: desc, url, image: p.images[0], jsonld: [product, crumbs], noscript, meta });
}

function categoryPage(base, key, items) {
  const c = CATS[key], url = `${SITE}/c/${key}/`;
  const sorted = [...items].sort((a, b) => (b.stock > 0) - (a.stock > 0) || b.id - a.id);
  const prices = sorted.map((p) => p.now);
  const list = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${c.plural} دست‌ساز حنا گالری`, url, description: c.intro,
    mainEntity: { '@type': 'ItemList', numberOfItems: sorted.length, itemListElement: sorted.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/p/${p.id}/`, name: p.name })) } };
  const crumbs = crumbLd([{ name: 'حنا گالری', url: SITE + '/' }, { name: c.plural, url }]);
  const noscript = `<h1>خرید ${esc(c.label)} دست‌ساز</h1><p>${esc(c.intro)}</p><ul>${sorted.map((p) => `<li><a href="/p/${p.id}/">${esc(p.name)}</a></li>`).join('')}</ul>`;
  return storePage(base, {
    title: `خرید ${c.label} دست‌ساز | ${c.plural}ی حنا گالری`,
    description: `${c.intro} ${fa(sorted.length)} مدل${prices.length ? ` از ${money(Math.min(...prices))} تا ${money(Math.max(...prices))} تومان` : ''}، با ارسال به سراسر ایران.`,
    url, image: sorted[0] && sorted[0].images[0], jsonld: [list, crumbs], noscript,
  });
}

function write(rel, content) {
  const f = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

const base = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const products = (await loadProducts()).map(normalize).filter((p) => p.name);
const reviews = await loadReviews();
for (const p of products) p.reviews = reviews.filter((r) => r.product_id === p.id);
if (products.length < 1) throw new Error('no products, refusing to wipe the pages');
for (const d of ['p', 'c']) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
for (const p of products) write(`p/${p.id}/index.html`, productPage(base, p, products));
const cats = Object.keys(CATS).filter((k) => products.some((p) => p.cat === k));
for (const k of cats) write(`c/${k}/index.html`, categoryPage(base, k, products.filter((p) => p.cat === k)));
// a product added since the last build has no page yet: GitHub Pages then serves 404.html, which is the store too
write('404.html', /<meta name="robots"[^>]*>/.test(base) ? base.replace(/<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex">') : base.replace(/(<meta name="viewport"[^>]*>)/, '$1\n<meta name="robots" content="noindex">'));

const latest = products.map((p) => p.updated).sort().pop(); // the sitemap only changes when the shop does
// each page lists its product photos (image sitemap), so the photos get indexed and can show beside the result
const inStock = [...products].sort((a, b) => (b.stock > 0) - (a.stock > 0) || b.id - a.id);
const pics = (list, n) => list.flatMap((p) => p.images.slice(0, 1)).slice(0, n);
const urls = [
  { loc: SITE + '/', mod: latest, pr: '1.0', imgs: pics(inStock, 20) },
  ...cats.map((k) => ({ loc: `${SITE}/c/${k}/`, mod: latest, pr: '0.8', imgs: pics(inStock.filter((p) => p.cat === k), 20) })),
  ...products.map((p) => ({ loc: `${SITE}/p/${p.id}/`, mod: p.updated, pr: '0.6', imgs: p.images.slice(0, 10) })),
];
const xmlEsc = (u) => esc(u);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.mod}</lastmod><priority>${u.pr}</priority>${u.imgs.map((i) => `<image:image><image:loc>${xmlEsc(i)}</image:loc></image:image>`).join('')}</url>`).join('\n')}\n</urlset>\n`);
console.log(`built ${products.length} product pages, ${cats.length} collection pages`);
