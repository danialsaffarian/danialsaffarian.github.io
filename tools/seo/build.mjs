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
  necklace: { label: 'گردنبند', plural: 'گردنبندها', intro: 'گردنبندهای دست‌ساز حنا گالری؛ از چوکرهای منجوقی و صدفی تا گردنبندهای مروارید و پلاک استیل با رنگ ثابت.',
    guide: ['هر گردنبند حنا گالری با دست و در تعداد محدود ساخته می‌شه؛ برای همین وقتی موجودی یه مدل تموم بشه، ممکنه دوباره عین همون ساخته نشه.',
      'برای استفاده‌ی هر روز، گردنبندهای ظریف و تک‌پلاک کنار هر لباسی می‌شینن؛ چوکرها و گردنبندهای منجوقی و صدفی برای استایل تابستونی و مهمونی‌های دوستانه انتخاب خوبی‌ان. اگه چند گردنبند رو با هم می‌ندازی، طول‌های متفاوت رو کنار هم بذار تا لایه‌ها از هم جدا دیده بشن.'],
    faq: [['گردنبند رو چطور نگه دارم که رنگش نره؟', 'قبل از دوش، استخر، ورزش و زدن عطر درش بیار و بعد از استفاده با یه پارچه‌ی نرم و خشک تمیزش کن. جداگونه و دور از رطوبت نگهش دار تا زنجیرش گره نخوره.'],
      ['برای هدیه چه گردنبندی انتخاب کنم؟', 'اگه سلیقه‌ی طرف رو دقیق نمی‌دونی، یه گردنبند ظریف با پلاک کوچیک یا مروارید تقریباً به هر استایلی می‌خوره و انتخاب کم‌ریسکیه.']] },
  bracelet: { label: 'دستبند', plural: 'دستبندها', intro: 'دستبندها و بنگل‌های حنا گالری؛ استیل با آبکاری طلا و نقره، دستبندهای صدفی و نخی، مناسب استفاده‌ی هر روز.',
    guide: ['دستبندهای حنا گالری دست‌ساز و در تعداد محدودن؛ از بنگل‌های فلزی که کنار ساعت هم خوش می‌شینن تا دستبندهای صدفی و نخی که حال‌وهوای تابستونی دارن.',
      'دستبند چون همیشه در معرض دست شستن و تماسه، زودتر از بقیه‌ی زیورها کدر می‌شه؛ موقع شستن دست، کارهای خونه و ورزش درش بیار تا رنگ و درخششش بیشتر بمونه.'],
    faq: [['اندازه‌ی دستبند رو چطور انتخاب کنم؟', 'دور مچت رو با یه متر خیاطی یا یه نخ اندازه بگیر و حدود یک تا دو سانت برای راحتی اضافه کن. اگه درباره‌ی اندازه‌ی یه مدل سؤال داشتی، قبل از خرید از طریق تلفن یا اینستاگرام بپرس.'],
      ['دستبند با ساعت ست می‌شه؟', 'بله؛ یه بنگل یا دستبند ظریف فلزی کنار ساعت، مخصوصاً هم‌رنگ با بدنه‌ی ساعت، ترکیب قشنگی می‌سازه.']] },
  earring: { label: 'گوشواره', plural: 'گوشواره‌ها', intro: 'گوشواره‌های حنا گالری؛ مدل‌های سنگی، مروارید، اشکی و ایرکاف، تکی یا پک، برای استایل روزمره و مهمونی.',
    guide: ['گوشواره‌های حنا گالری از مدل‌های ریز و روزمره تا آویزهای سنگی و اشکی برای مهمونی رو شامل می‌شه؛ بعضی مدل‌ها تکی‌ان و بعضی به‌صورت پک چندتایی عرضه می‌شن.',
      'ایرکاف‌ها بدون نیاز به سوراخ روی لاله‌ی گوش می‌شینن و برای کسی که گوشش سوراخ نیست یا می‌خواد کنار گوشواره‌ی اصلی‌اش یه لایه‌ی دیگه اضافه کنه، انتخاب خوبی‌ان.'],
    faq: [['گوشواره رو می‌شه مرجوع کرد؟', 'بله؛ تا ۷ روز کاری بعد از تحویل، به شرط اینکه سالم، استفاده‌نشده و با بسته‌بندی اولیه برگرده. جزئیات در صفحه‌ی قوانین و مقررات آمده.'],
      ['ایرکاف چیه؟', 'ایرکاف گوشواره‌ایه که بدون سوراخ، روی لبه‌ی گوش گیر می‌کنه؛ هم تنها استفاده می‌شه و هم کنار گوشواره‌های دیگه.']] },
  ring: { label: 'انگشتر', plural: 'انگشترها', intro: 'انگشترهای استیل حنا گالری با آبکاری طلا و نقره و نگین‌های ظریف؛ رنگ ثابت و مناسب استفاده‌ی همیشگی.',
    guide: ['انگشترهای حنا گالری ظریف و سبک‌ان و برای استفاده‌ی هر روز ساخته شدن؛ چند انگشتر نازک رو می‌شه کنار هم روی یه انگشت یا انگشت‌های مختلف انداخت.',
      'انگشتر بیشتر از هر زیوری با آب و صابون و مواد شوینده تماس داره؛ موقع شستن ظرف، استفاده از کرم دست و مواد ضدعفونی درش بیار تا آبکاری‌اش دیرتر کم‌رنگ بشه.'],
    faq: [['سایز انگشتر رو چطور بفهمم؟', 'یه نخ دور انگشتت بپیچ، محل رسیدن دو سرش رو علامت بزن و طولش رو با خط‌کش اندازه بگیر؛ این عدد محیط انگشته. اگه سایز یه مدل رو نمی‌دونستی، قبل از خرید بپرس.'],
      ['انگشتر چند تا با هم بندازم؟', 'قانون ثابتی نداره؛ معمولاً دو سه انگشتر نازک با رنگ یکسان یا یه انگشتر نگین‌دار تنها، تمیزتر از تعداد زیاد دیده می‌شه.']] },
  anklet: { label: 'پابند', plural: 'پابندها', intro: 'پابندهای دست‌ساز حنا گالری؛ ستاره، صدف، دم وال و چشم نظر با منجوق‌های رنگی.',
    guide: ['پابندهای حنا گالری با منجوق، صدف و آویزهای کوچیک دست‌ساز می‌شن و حال‌وهوای تابستون و سفرهای دریایی رو دارن.',
      'پابند بیشتر از بقیه‌ی زیورها با آب، شن و تعریق تماس داره؛ بعد از دریا یا استخر با آب شیرین آبکشی و خشکش کن و برای نگهداری جدا بذارش که منجوق‌ها خراش نخورن.'],
    faq: [['پابند رو با چی ست کنم؟', 'با صندل و کفش‌های باز، شلوار کوتاه یا دامن بلند؛ پابند ظریف با یه دستبند هم‌حال‌وهوا ست قشنگی می‌سازه.'],
      ['پابند تو آب دریا خراب می‌شه؟', 'آب شور و شن به مرور به رنگ و نخ آسیب می‌زنن؛ بهتره قبل از شنا درش بیاری یا بعدش با آب شیرین آبکشی و خشکش کنی.']] },
  hair: { label: 'اکسسوری مو', plural: 'اکسسوری‌های مو', intro: 'اکسسوری‌های موی حنا گالری؛ تل مو، شال مو و گوش‌گیر، برای استایل روزمره و روزهای سرد.',
    guide: ['اکسسوری‌های موی حنا گالری شامل تل مو، شال مو و گوش‌گیره؛ هم برای مرتب نگه داشتن مو در طول روز و هم برای گرم نگه داشتن سر و گوش در روزهای سرد.',
      'اکسسوری پارچه‌ای رو با دست و آب ولرم بشور، فشار نده و روی سطح صاف خشکش کن تا فرمش حفظ بشه.'],
    faq: [['تل مو اذیت نمی‌کنه؟', 'اگه بعد از مدتی پشت گوش رو فشار داد، لحظه‌ای درش بیار و دوباره کمی عقب‌تر بذار؛ تل‌های پهن‌تر و نرم‌تر فشار رو پخش‌تر می‌کنن.'],
      ['گوش‌گیر رو چطور بشورم؟', 'با دست و آب ولرم و کمی شوینده‌ی ملایم بشور و بدون پیچوندن، در سایه خشکش کن.']] },
};
// true for every order, from the terms page and the shop's own FAQ
const SHOP_FAQ = [
  ['ارسال چقدر طول می‌کشه؟', 'سفارش‌ها معمولاً طی ۲ تا ۴ روز کاری آماده و با پست یا تیپاکس به سراسر ایران فرستاده می‌شن؛ هزینه‌ی ارسال موقع تحویل پرداخت می‌شه.'],
  ['می‌شه از خرید انصراف داد؟', 'بله؛ تا ۷ روز کاری بعد از تحویل و بدون ذکر دلیل، به شرط سالم و استفاده‌نشده بودن کالا. طرح‌هایی که سفارشی ساخته می‌شن شامل این شرط نیستن.'],
  ['پرداخت چطوریه؟', 'پرداخت آنلاین از طریق درگاه امن زیبال انجام می‌شه و اطلاعات کارت فقط در صفحه‌ی بانک وارد می‌شه.'],
];
const GUIDES = [
  { url: '/guide/care/', title: 'راهنمای نگهداری از زیورآلات' },
  { url: '/guide/gift/', title: 'راهنمای انتخاب هدیه' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const money = (n) => fa(Math.round(Number(n)).toLocaleString('en-US'));
const plain = (s) => String(s || '').replace(/\p{Extended_Pictographic}|️/gu, '').replace(/\s+/g, ' ').trim();

async function loadProducts() {
  const file = process.argv[2];
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const html = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8');
  const url = (html.match(/const SUPABASE_DIRECT = '([^']+)'/) || html.match(/const SUPABASE_URL = '([^']+)'/))[1];
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
    const html = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8');
    const url = (html.match(/const SUPABASE_DIRECT = '([^']+)'/) || html.match(/const SUPABASE_URL = '([^']+)'/))[1];
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

// as stated on the terms page (/terms/): 7 working days to withdraw after delivery, per articles 37-38 of the e-commerce law
const RETURNS = { '@type': 'MerchantReturnPolicy', applicableCountry: 'IR', returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: 7, returnMethod: 'https://schema.org/ReturnByMail', merchantReturnLink: SITE + '/terms/#withdrawal' };

const crumbLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })) });

// the store's page with this address's own head; the home page's other structured data (FAQ etc.) stays on the home page only
// Google reads the page as rendered, where <noscript> is skipped: the product's or collection's own text also goes in a visible
// section, and the store's «Hana Gallery» hero stops being this page's h1, so each address is no longer a copy of the home page.
function storePage(base, { title, description, url, image, jsonld, noscript, section = '', meta = '' }) {
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
  set(/<h1 class="hero-title">([\s\S]*?)<\/h1>/, '<div class="hero-title">$1</div>');
  if (section) set(/<section class="section about" id="about">/, `<section class="section seo-info">\n<div class="wrap">${section}</div>\n</section>\n\n$&`);
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
  // the products either side of this one in its collection, so every product is linked from a few others
  const same = all.filter((x) => x.cat === p.cat).sort((a, b) => a.id - b.id);
  const at = same.findIndex((x) => x.id === p.id);
  const others = same.length > 1 ? [...new Set([1, -1, 2, -2, 3, -3, 4, -4].map((d) => same[(at + d + same.length * 10) % same.length]))].filter((x) => x.id !== p.id).slice(0, 8) : [];
  const names = [...new Set(p.variants.map((v) => v.name).filter(Boolean))];
  const otherCats = Object.keys(CATS).filter((k) => k !== p.cat && all.some((x) => x.cat === k));
  const noscript = `<h1>${esc(p.name)}</h1><p>${p.stock > 0 ? `${money(p.now)} تومان` : 'ناموجود'}</p>${p.images[0] ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" width="400">` : ''}${p.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${others.length ? `<p>${others.map((o) => `<a href="/p/${o.id}/">${esc(o.name)}</a>`).join(' · ')}</p>` : ''}`;
  const section = `<nav class="seo-crumbs" aria-label="مسیر"><a href="/">حنا گالری</a><span>›</span>${cat ? `<a href="/c/${p.cat}/">${esc(cat.plural)}</a><span>›</span>` : ''}<b>${esc(p.name)}</b></nav>`
    + `<h1>${esc(p.name)}</h1><p class="seo-price">${p.stock > 0 ? `${money(p.now)} تومان${p.sale !== null ? ` <s>${money(p.price)}</s>` : ''}` : 'فعلاً ناموجود'}</p>`
    + (p.lines.length ? `<ul class="seo-lines">${p.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
      : `<p>${esc(p.name)}، از ${cat ? esc(cat.plural) + 'ی' : 'محصولات'} دست‌ساز حنا گالری${names.length > 1 ? ` در ${fa(names.length)} رنگ و مدل` : ''}. ${cat ? esc(cat.intro) : ''}</p>`)
    + `<dl class="seo-specs"><dt>دسته</dt><dd>${cat ? `<a href="/c/${p.cat}/">${esc(cat.label)}</a>` : esc(p.catLabel)}</dd>`
    + (names.length ? `<dt>رنگ و مدل</dt><dd>${names.map(esc).join('، ')}</dd>` : '')
    + `<dt>موجودی</dt><dd>${p.stock > 0 ? (p.stock <= 2 ? `فقط ${fa(p.stock)} عدد` : 'موجود') : 'فعلاً ناموجود'}</dd>`
    + `<dt>ساخت</dt><dd>دست‌ساز، در تعداد محدود</dd>`
    + `<dt>ارسال</dt><dd>۲ تا ۴ روز کاری، با پست یا تیپاکس به سراسر ایران</dd>`
    + `<dt>انصراف از خرید</dt><dd>تا ۷ روز کاری بعد از تحویل (<a href="/terms/#withdrawal">شرایط</a>)</dd>`
    + `<dt>کد محصول</dt><dd>${fa(p.id)}</dd></dl>`
    + `<p><a class="seo-open" href="#p${p.id}">دیدن عکس‌ها و خرید</a></p>`
    + (others.length ? `<h2>${cat ? `${esc(cat.plural)}ی دیگه` : 'محصولات دیگه'}</h2><ul class="seo-links">${others.map((o) => `<li><a href="/p/${o.id}/">${esc(o.name)}</a></li>`).join('')}</ul>` : '')
    + (otherCats.length ? `<h2>کالکشن‌های دیگه</h2><ul class="seo-links">${otherCats.map((k) => `<li><a href="/c/${k}/">${esc(CATS[k].plural)}</a></li>`).join('')}</ul>` : '')
    + `<p class="seo-guides">${GUIDES.map((g) => `<a href="${g.url}">${esc(g.title)}</a>`).join(' · ')}</p>`;
  // price-comparison crawlers (ترب و ...) read these; prices in toman
  const meta = [
    `<meta name="product_id" content="${p.id}">`,
    `<meta name="product_name" content="${esc(p.name)}">`,
    `<meta name="product_price" content="${p.now}">`,
    p.sale !== null ? `<meta name="product_old_price" content="${p.price}">` : '',
    `<meta name="availability" content="${p.stock > 0 ? 'instock' : 'outofstock'}">`,
  ].filter(Boolean).join('\n');
  return storePage(base, { title: `${p.name} | خرید ${p.catLabel} دست‌ساز - حنا گالری`, description: desc, url, image: p.images[0], jsonld: [product, crumbs], noscript, section, meta });
}

function categoryPage(base, key, items) {
  const c = CATS[key], url = `${SITE}/c/${key}/`;
  const sorted = [...items].sort((a, b) => (b.stock > 0) - (a.stock > 0) || b.id - a.id);
  const prices = sorted.map((p) => p.now);
  const list = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${c.plural} دست‌ساز حنا گالری`, url, description: c.intro,
    mainEntity: { '@type': 'ItemList', numberOfItems: sorted.length, itemListElement: sorted.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/p/${p.id}/`, name: p.name })) } };
  const crumbs = crumbLd([{ name: 'حنا گالری', url: SITE + '/' }, { name: c.plural, url }]);
  const noscript = `<h1>خرید ${esc(c.label)} دست‌ساز</h1><p>${esc(c.intro)}</p><ul>${sorted.map((p) => `<li><a href="/p/${p.id}/">${esc(p.name)}</a></li>`).join('')}</ul>`;
  const qa = [...c.faq, ...SHOP_FAQ];
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
  const otherCats = Object.keys(CATS).filter((k) => k !== key);
  const section = `<nav class="seo-crumbs" aria-label="مسیر"><a href="/">حنا گالری</a><span>›</span><b>${esc(c.plural)}</b></nav><h1>خرید ${esc(c.label)} دست‌ساز</h1><p>${esc(c.intro)}</p>`
    + c.guide.map((g) => `<p>${esc(g)}</p>`).join('')
    + `<h2>${fa(sorted.length)} مدل ${esc(c.label)}</h2><ul class="seo-links">${sorted.map((p) => `<li><a href="/p/${p.id}/">${esc(p.name)}</a>${p.stock > 0 ? ` <small>${money(p.now)} تومان</small>` : ' <small>ناموجود</small>'}</li>`).join('')}</ul>`
    + `<h2>سؤال‌های رایج درباره‌ی ${esc(c.plural)}</h2><div class="seo-faq">${qa.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}</div>`
    + `<h2>کالکشن‌های دیگه</h2><ul class="seo-links">${otherCats.map((k) => `<li><a href="/c/${k}/">${esc(CATS[k].plural)}</a></li>`).join('')}</ul>`
    + `<p class="seo-guides">${GUIDES.map((g) => `<a href="${g.url}">${esc(g.title)}</a>`).join(' · ')}</p>`;
  return storePage(base, {
    title: `خرید ${c.label} دست‌ساز | ${c.plural}ی حنا گالری`,
    description: `${c.intro} ${fa(sorted.length)} مدل${prices.length ? ` از ${money(Math.min(...prices))} تا ${money(Math.max(...prices))} تومان` : ''}، با ارسال به سراسر ایران.`,
    url, image: sorted[0] && sorted[0].images[0], jsonld: [list, crumbs, faqLd], noscript, section,
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
  { loc: SITE + '/terms/', mod: '2026-10-31', pr: '0.3', imgs: [] },
  ...GUIDES.map((g) => ({ loc: SITE + g.url, mod: '2026-11-13', pr: '0.5', imgs: [] })),
  ...cats.map((k) => ({ loc: `${SITE}/c/${k}/`, mod: latest, pr: '0.8', imgs: pics(inStock.filter((p) => p.cat === k), 20) })),
  ...products.map((p) => ({ loc: `${SITE}/p/${p.id}/`, mod: p.updated, pr: '0.6', imgs: p.images.slice(0, 10) })),
];
const xmlEsc = (u) => esc(u);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.mod}</lastmod><priority>${u.pr}</priority>${u.imgs.map((i) => `<image:image><image:loc>${xmlEsc(i)}</image:loc></image:image>`).join('')}</url>`).join('\n')}\n</urlset>\n`);
console.log(`built ${products.length} product pages, ${cats.length} collection pages`);
