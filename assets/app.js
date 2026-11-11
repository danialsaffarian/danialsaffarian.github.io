// supabase.co is blocked in Iran: requests go through our relay on Arvan's edge (api.hanagalleryy.ir, proxy/edge.js);
// if the relay can't be reached this visit falls back to Supabase directly, so VPN users are never worse off
const SUPABASE_DIRECT = 'https://goykyskctygnciwttfqj.supabase.co';
const SUPABASE_RELAY = 'https://api.hanagalleryy.ir';
const SUPABASE_URL = SUPABASE_RELAY;
const SUPABASE_KEY = 'sb_publishable_ZUgUSquwnM1YNMsL6OKgQQ_lS5EmsuG';
let useRelay = true;
const viaRelay = u => (useRelay && typeof u === 'string') ? u.replace(SUPABASE_DIRECT, SUPABASE_RELAY) : u;
const toDirect = u => typeof u === 'string' ? u.replace(SUPABASE_RELAY, SUPABASE_DIRECT) : u;
// pick the faster road once per visit: Supabase directly (abroad, or wherever it isn't blocked) or the Iranian relay.
// Both tiny health checks race; whichever answers first wins. If neither answers in 4 s the relay is used.
const routeReady = (async () => {
  const ok = (url, opts) => fetch(url, { cache: 'no-store', ...opts }).then(r => { if(!r.ok) throw 0; return true; });
  const direct = ok(SUPABASE_DIRECT + '/auth/v1/health', { headers: { apikey: SUPABASE_KEY } }).then(() => false);
  const relay = ok(SUPABASE_RELAY + '/__relay/health').then(() => true);
  const timeout = new Promise(res => setTimeout(() => res(true), 4000));
  try{ useRelay = await Promise.race([Promise.any([direct, relay]), timeout]); }catch(e){ useRelay = true; }
})();
async function relayFetch(input, init){
  let url = typeof input === 'string' ? input : input.url;
  if(!url.startsWith(SUPABASE_RELAY)) return fetch(input, init);
  await routeReady;
  const direct = () => SUPABASE_DIRECT + url.slice(SUPABASE_RELAY.length);
  if(!useRelay) return fetch(direct(), init);
  try{
    const r = await fetch(url, init);
    if(r.status !== 502) return r;
    const t = await r.clone().text();
    if(!t.includes('relay:')) return r;
  }catch(e){}
  useRelay = false;
  return fetch(direct(), init);
}
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: relayFetch },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'hana-gallery-auth',
  },
});
// live order alerts (admin) keep a direct WebSocket; the relay forwards plain HTTP
try{ const rt = db.realtime, sock = (rt.socketAdapter && (rt.socketAdapter.socket || rt.socketAdapter)) || rt.socket; sock.endPoint = SUPABASE_DIRECT.replace('https:', 'wss:') + '/realtime/v1/websocket'; }catch(e){}

/* ================= آمار بازدید محصولات =================
   بازدید سایت، دیدن هر محصول و افزودن به سبد، یک بار در روز برای هر مرورگر شمرده می‌شه.
   فقط یه شناسه‌ی تصادفی ذخیره می‌شه، هیچ اطلاعات شخصی‌ای نه. */
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
const hgSession = (() => {
  let sid = lsGet('hg-sid');
  if(!sid || !/^[A-Za-z0-9_-]{8,40}$/.test(sid)){
    sid = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('');
    lsSet('hg-sid', sid);
  }
  return sid;
})();
const trackedOnce = new Set();
function trackEvent(kind, productId){
  const key = kind + ':' + (productId || '');
  if(trackedOnce.has(key)) return;
  trackedOnce.add(key);
  db.rpc('track_event', { p_kind: kind, p_product: productId || null, p_source: null, p_session: hgSession }).then(() => {}, () => {});
}
trackEvent('visit');

const LOW_STOCK_THRESHOLD = 2; // اگر موجودی مساوی یا کمتر از این عدد بود، هشدار «تعداد محدود» نشون داده می‌شه

// چرخه‌ی آیکون و رنگ پس‌زمینه بر اساس دسته‌ی محصول (چون عکس واقعی هنوز نداریم)
const ICON_BY_CAT = {necklace:['necklace','necklace2'], earring:['earring','earring2'], bracelet:['bracelet','bracelet2'], ring:['ring','ring2'], anklet:['anklet','anklet2'], hair:['hair','hair']};
const normCat = c => (c || '').toString().trim().toLowerCase();
const BG_CYCLE = ['var(--blush)','var(--tan)'];

let products = [];

function skeletonCardHtml(){
  return `<div class="card"><div class="skeleton-visual"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>`;
}

async function fetchProducts(){
  grid.innerHTML = Array(PAGE_SIZE).fill(skeletonCardHtml()).join('');
  const { data, error } = await db.from('products').select('*').order('id');
  if(error){
    console.error('خطا در خواندن محصولات از Supabase:', error);
    const detail = (error.message || '') + (error.details ? ' — ' + error.details : '') + (error.hint ? ' — ' + error.hint : '');
    grid.innerHTML = `<p style="text-align:center;color:var(--coffee-70);grid-column:1/-1;">مشکلی در بارگذاری محصولات پیش آمد.<br><span style="font-size:12px;direction:ltr;display:inline-block;margin-top:8px;">${escapeHtml(detail || JSON.stringify(error))}</span></p>`;
    return;
  }
  products = data.map((p, i) => {
    const rawSale = p.sale_price;
    const nowMs = Date.now();
    const saleOpen = (!p.sale_starts_at || new Date(p.sale_starts_at).getTime() <= nowMs) && (!p.sale_ends_at || new Date(p.sale_ends_at).getTime() > nowMs);
    const salePrice = (saleOpen && rawSale !== null && rawSale !== undefined && rawSale !== '' && !isNaN(rawSale) && Number(rawSale) > 0 && Number(rawSale) < Number(p.price)) ? Number(rawSale) : null;
    return {
    id: p.id,
    name: p.name,
    cat: normCat(p.category),
    catLabel: p.category_label,
    price: p.price,
    salePrice,
    saleEndsAt: salePrice !== null && p.sale_ends_at ? p.sale_ends_at : null,
    effectivePrice: salePrice !== null ? salePrice : p.price,
    description: p.description || '',
    stock: p.stock,
    isNew: p.is_new,
    imageUrl: p.image_url ? viaRelay(p.image_url.split(/[,،]/).map(s => s.trim()).filter(Boolean)[0]) || null : null,
    images: p.image_url ? p.image_url.split(/[,،]/).map(s => s.trim()).filter(Boolean).map(viaRelay) : [],
    thumbs: p.image_url ? p.image_url.split(/[,،]/).map(s => s.trim()).filter(Boolean).map(thumbUrl) : [],
    variants: p.variants ? p.variants.split(/[,،]/).map(v => v.trim()).filter(Boolean).map(v => {
      const parts = v.split(':');
      const name = parts[0].trim();
      const rest = parts[1] ? parts[1].trim() : null;
      let qty = null; // null یعنی موجودی برای این گزینه جدا وارد نشده (همیشه موجود در نظر گرفته می‌شه)
      let available = true;
      if(rest !== null){
        if(rest === 'ناموجود'){ qty = 0; available = false; }
        else {
          const n = parseInt(rest, 10);
          if(!isNaN(n)){ qty = n; available = n > 0; }
        }
      }
      let price = null; // null یعنی این گزینه قیمت مخصوص نداره و از قیمت خود محصول استفاده می‌شه
      if(parts[2] !== undefined && parts[2].trim() !== ''){
        const priceNum = Number(parts[2].trim());
        if(!isNaN(priceNum) && priceNum > 0) price = priceNum;
      }
      return { name, qty, available, price };
    }) : [],
    icon: (ICON_BY_CAT[normCat(p.category)] || ['necklace'])[p.id % 2],
    bg: BG_CYCLE[i % 2],
    };
  });
  renderNewest();
  renderSaleProducts();
  injectProductsJsonLd();
}

function injectProductsJsonLd(){
  const existing = document.getElementById('productsJsonLd');
  if(existing) existing.remove();
  if(!products.length) return;
  // the full product data lives on each product's own page (/p/<id>/); this list only points to them
  const itemListElement = products.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: 'https://hanagalleryy.ir/p/' + p.id + '/' }));
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = 'productsJsonLd';
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement,
  });
  document.head.appendChild(script);
}

const icons = {
  necklace:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><path d="M20 15 Q50 55 80 15"/><circle cx="50" cy="65" r="14"/></svg>`,
  necklace2:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><path d="M20 15 Q50 50 80 15"/><circle cx="40" cy="60" r="6"/><circle cx="50" cy="68" r="6"/><circle cx="60" cy="60" r="6"/></svg>`,
  earring:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><circle cx="50" cy="25" r="9"/><path d="M50 34 L50 55"/><path d="M30 55 Q50 95 70 55"/></svg>`,
  earring2:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><circle cx="50" cy="30" r="8"/><circle cx="50" cy="65" r="26"/></svg>`,
  bracelet:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><ellipse cx="50" cy="50" rx="36" ry="18"/><path d="M20 50 h60 M20 44 h60 M20 56 h60" stroke-width="1.2"/></svg>`,
  bracelet2:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><ellipse cx="50" cy="50" rx="36" ry="20"/><circle cx="50" cy="30" r="5" fill="var(--coffee)" stroke="none"/></svg>`,
  ring:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><circle cx="50" cy="58" r="24"/><path d="M38 34 L50 14 L62 34"/></svg>`,
  ring2:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><circle cx="50" cy="55" r="24"/><path d="M32 36 Q50 20 68 36"/></svg>`,
  anklet:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><ellipse cx="50" cy="45" rx="34" ry="14"/><path d="M50 59 L50 75"/><circle cx="50" cy="81" r="5"/></svg>`,
  anklet2:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><path d="M15 40 Q50 72 85 40"/><circle cx="25" cy="49" r="4"/><circle cx="38" cy="60" r="4"/><circle cx="50" cy="64" r="4"/><circle cx="62" cy="60" r="4"/><circle cx="75" cy="49" r="4"/></svg>`,
  hair:`<svg viewBox="0 0 100 100" fill="none" style="stroke:var(--coffee)" stroke-width="1.8"><path d="M20 72C20 36 33 22 50 22S80 36 80 72"/><path d="M50 22L40 16V28ZM50 22L60 16V28Z"/><circle cx="50" cy="22" r="3"/></svg>`,
};

const toFa = n => (Number(n) || 0).toLocaleString('fa-IR'); // an empty field must not break the page

let toastTimer = null;
function showToast(msg){
  let el = document.getElementById('siteToast');
  if(!el){
    el = document.createElement('div');
    el.id = 'siteToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
let cart = [];
let currentUser = null;     // signed-in Supabase user (declared early: the cart reads it)
let currentProfile = null;

const grid = document.getElementById('productGrid');
const paginationEl = document.getElementById('pagination');
const PAGE_SIZE = 8;
let currentSearch = '';
const normFa = str => String(str || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').toLowerCase();
let currentPage = 1;
let currentSort = 'newest';

function variantOptionLabel(v){
  if(!v.available) return `${v.name} (ناموجود)`;
  if(v.qty !== null && v.qty <= LOW_STOCK_THRESHOLD) return `${v.name} (فقط ${toFa(v.qty)} عدد)`;
  return v.name;
}
function variantStatusHtml(v){
  if(!v.available) return { text: 'این گزینه ناموجود است', cls: 'sold' };
  if(v.qty !== null && v.qty <= LOW_STOCK_THRESHOLD) return { text: `فقط ${toFa(v.qty)} عدد از این گزینه باقی مانده`, cls: 'low' };
  return { text: '', cls: '' };
}
function priceForVariant(p, variant){
  if(variant && variant.price !== null && variant.price !== undefined) return variant.price;
  return p.effectivePrice;
}
function priceHtml(p, variant, cls, id){
  const idAttr = id ? ` id="${id}"` : '';
  if(variant && variant.price !== null && variant.price !== undefined){
    return `<span class="${cls}"${idAttr}>${toFa(variant.price)} تومان</span>`;
  }
  const onSale = p.salePrice !== null && p.salePrice !== undefined;
  return onSale
    ? `<span class="${cls}"${idAttr}><span class="price-old">${toFa(p.price)} تومان</span><span class="price-sale">${toFa(p.salePrice)} تومان</span></span>`
    : `<span class="${cls}"${idAttr}>${toFa(p.price)} تومان</span>`;
}
// '۲ روز دیگه' style countdown for a timed sale
function saleEndsText(iso){
  const ms = new Date(iso).getTime() - Date.now();
  if(!(ms > 0)) return '';
  const h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
  const left = d >= 1 ? `${toFa(d)} روز` : h >= 1 ? `${toFa(h)} ساعت` : `${toFa(Math.max(1, Math.floor(ms / 60000)))} دقیقه`;
  return `<span class="sale-ends">حراج تا ${left} دیگه</span>`;
}
// product cards load a ~640px copy (thumbs/…) instead of the full photo: about 3x lighter.
// if a copy is missing, the <img> falls back to the full photo by itself (onerror)
const IMG_FULL = '/storage/v1/object/public/image/products/';
const IMG_THUMB = '/storage/v1/object/public/image/thumbs/';
function thumbUrl(url){ url = viaRelay(url); return typeof url === 'string' && url.includes(IMG_FULL) ? url.replace(IMG_FULL, IMG_THUMB) : url; }
function thumbFallback(img){ if(img.src.includes(IMG_THUMB)) img.src = img.src.replace(IMG_THUMB, IMG_FULL); }

let wishBurstId = null;
function productCardHtml(p){
  const soldOut = p.stock === 0;
  const lowStock = !soldOut && p.stock <= LOW_STOCK_THRESHOLD;
  const onSale = p.salePrice !== null && p.salePrice !== undefined;
  const discountPct = onSale ? Math.round((1 - p.salePrice / p.price) * 100) : 0;
  let leftBadges = '';
  if(p.isNew) leftBadges += '<span class="tag-new">تازه</span>';
  if(soldOut) leftBadges += '<span class="tag-soldout">ناموجود</span>';
  let rightBadges = '';
  if(onSale && !soldOut) rightBadges += `<span class="tag-sale">${toFa(discountPct)}٪ تخفیف</span>`;
  const wishActive = wishlistIds.has(p.id);
  const heartBtn = `<button class="wish-btn${wishActive ? ' active' : ''}${wishActive && wishBurstId === p.id ? ' burst' : ''}" onclick="toggleWishlist(${p.id})" aria-label="علاقه‌مندی"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-9.5-9C1 7.5 2.8 4 6.2 4c2 0 3.4 1.1 4.3 2.4C11.4 5.1 12.8 4 14.8 4 18.2 4 20 7.5 18.5 11c-2.5 4.6-9.5 9-9.5 9z"/></svg></button>`;
  const badge = (leftBadges ? `<div class="badge-col badge-left">${leftBadges}</div>` : '')
    + `<div class="badge-col badge-right">${heartBtn}</div>`
    + (rightBadges ? `<div class="badge-col badge-right badge-bottom">${rightBadges}</div>` : '');
  const hasVariants = p.variants && p.variants.length > 0;
  const firstVariant = hasVariants ? p.variants[0] : null;
  const firstAvailable = hasVariants && firstVariant.available;
  const firstStatus = hasVariants ? variantStatusHtml(firstVariant) : { text: '', cls: '' };
  const priceHtmlStr = priceHtml(p, firstVariant, 'card-price');
  const variantSelect = hasVariants ? `
      <select class="variant-select" ${soldOut?'disabled':''} onchange="onVariantChange(${p.id}, this)">
        ${p.variants.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(variantOptionLabel(v))}</option>`).join('')}
      </select>
      <p class="variant-status ${firstStatus.cls}" style="display:${firstStatus.text ? 'block' : 'none'};">${firstStatus.text}</p>` : '';
  const buyDisabled = soldOut || (hasVariants && !firstAvailable);
  const images = p.images && p.images.length > 0 ? p.images : [];
  const hasImages = images.length > 0;
  const hasMultiImages = images.length > 1;
  const shownIdx = hasMultiImages ? (cardImageIndex[p.id] || 0) % images.length : 0;
  return `
  <div class="card${soldOut?' soldout':''}" data-id="${p.id}">
    <div class="card-visual" ${hasMultiImages ? `data-visual="${p.id}" onpointerenter="preloadProductImages(${p.id})"` : ''} style="background:${hasImages ? '#fff' : p.bg}">
      <div class="card-shine"></div>
      ${badge}
      ${hasImages ? `<img src="${escapeHtml(thumbUrl(images[shownIdx]))}" alt="${escapeHtml(p.name)}" class="card-photo" data-pid="${p.id}" loading="lazy" decoding="async" onerror="thumbFallback(this)">` : icons[p.icon]}
      ${hasMultiImages ? `
        <button class="img-nav right" onclick="event.stopPropagation(); changeCardImage(${p.id}, 1)" aria-label="عکس بعدی"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg></button>
        <div class="img-dots">${images.map((_,i) => `<span class="img-dot${i===shownIdx?' active':''}" onclick="event.stopPropagation(); setCardImage(${p.id}, ${i})"></span>`).join('')}</div>
      ` : ''}
    </div>
    <div class="card-body">
      <span class="card-cat">${escapeHtml(p.catLabel)}</span>
      <span class="card-name">${escapeHtml(p.name)}</span>
      ${priceHtmlStr}
      ${lowStock ? `<span class="card-stock">فقط ${toFa(p.stock)} عدد باقی مونده</span>` : ''}
      ${p.saleEndsAt ? saleEndsText(p.saleEndsAt) : ''}
      ${variantSelect}
      <button class="buy-btn" onclick="addToCart(${p.id}, this)" ${buyDisabled?'disabled':''}>${soldOut?'ناموجود':(buyDisabled?'ناموجود':'افزودن به سبد خرید')}</button>
    </div>
  </div>`;
}

function onVariantChange(productId, el){
  const p = products.find(p => p.id === productId);
  const card = el && el.closest('.card');
  if(!p || !p.variants || !card) return;
  const sel = card.querySelector('.variant-select');
  const statusEl = card.querySelector('.variant-status');
  const btn = card.querySelector('.buy-btn');
  const priceEl = card.querySelector('.card-price');
  const chosen = p.variants.find(v => v.name === sel.value);
  if(!chosen) return;
  const status = variantStatusHtml(chosen);
  statusEl.textContent = status.text;
  statusEl.className = 'variant-status' + (status.cls ? ' ' + status.cls : '');
  statusEl.style.display = status.text ? 'block' : 'none';
  btn.disabled = !chosen.available;
  btn.textContent = chosen.available ? 'افزودن به سبد خرید' : 'ناموجود';
  if(priceEl) priceEl.outerHTML = priceHtml(p, chosen, 'card-price');
}

let cardImageIndex = {};
function preloadImages(urls){
  if(!urls) return;
  urls.forEach(url => { const img = new Image(); img.src = url; });
}
function preloadProductImages(productId){
  const p = products.find(p => p.id === productId);
  if(p) preloadImages(p.images);
}
function swapImageSrc(img, url){
  if(img.getAttribute('src') === url) return;
  img.dataset.want = url;
  const box = img.parentElement;
  const loader = new Image();
  const done = () => {
    if(img.dataset.want !== url) return; // a newer click already asked for another photo
    img.src = url;
    if(box) box.classList.remove('img-loading');
  };
  loader.onload = done;
  loader.onerror = done;
  loader.src = url;
  if(loader.complete){ done(); return; }
  if(box) box.classList.add('img-loading');
}
function preloadNextImage(images, idx){
  if(images && images.length > 1) preloadImages([images[(idx + 1) % images.length]]);
}
// cards with several photos fetch their second photo as soon as they scroll into view
const cardPreloadObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  entries.forEach(e => {
    if(!e.isIntersecting) return;
    cardPreloadObserver.unobserve(e.target);
    const p = products.find(p => p.id === Number(e.target.dataset.id));
    if(p) preloadNextImage(p.thumbs, 0);
  });
}, { rootMargin: '200px' }) : null;
function observeCardPreloads(){
  if(!cardPreloadObserver) return;
  document.querySelectorAll('.card-visual[data-visual]').forEach(v => {
    const card = v.closest('.card');
    if(card) cardPreloadObserver.observe(card);
  });
}
function setCardImage(productId, idx){
  const p = products.find(p => p.id === productId);
  if(!p || !p.images || !p.images.length) return;
  cardImageIndex[productId] = idx;
  // the same product can be on the page several times (newest, on sale, all products): update every copy
  document.querySelectorAll(`.card-photo[data-pid="${productId}"]`).forEach(img => swapImageSrc(img, p.thumbs[idx]));
  preloadNextImage(p.thumbs, idx);
  document.querySelectorAll(`.card-visual[data-visual="${productId}"]`).forEach(visual => {
    visual.querySelectorAll('.img-dot').forEach((dot, i) => dot.classList.toggle('active', i === idx));
  });
}
function changeCardImage(productId, dir){
  const p = products.find(p => p.id === productId);
  if(!p || !p.images || p.images.length < 2) return;
  const len = p.images.length;
  let idx = ((cardImageIndex[productId] || 0) + dir + len) % len;
  setCardImage(productId, idx);
}

/* ================= صفحه‌ی جداگانه‌ی جزئیات محصول ================= */
let currentDetailProduct = null;
let detailImageIndex = 0;
const productPage = document.getElementById('productPage');

function detailBadgeHtml(p, soldOut, lowStock, onSale, discountPct){
  let leftBadges = '';
  if(p.isNew) leftBadges += '<span class="tag-new">تازه</span>';
  if(soldOut) leftBadges += '<span class="tag-soldout">ناموجود</span>';
  else if(lowStock) leftBadges += `<span class="tag-stock">فقط ${toFa(p.stock)} عدد باقی مانده</span>`;
  let rightBadges = '';
  if(onSale && !soldOut) rightBadges += `<span class="tag-sale">${toFa(discountPct)}٪ تخفیف</span>`;
  return (leftBadges ? `<div class="badge-col badge-left">${leftBadges}</div>` : '') + (rightBadges ? `<div class="badge-col badge-right badge-bottom">${rightBadges}</div>` : '');
}

function renderProductDetail(){
  const p = currentDetailProduct;
  if(!p) return;
  const soldOut = p.stock === 0;
  const lowStock = !soldOut && p.stock <= LOW_STOCK_THRESHOLD;
  const onSale = p.salePrice !== null && p.salePrice !== undefined;
  const discountPct = onSale ? Math.round((1 - p.salePrice / p.price) * 100) : 0;
  // sale and low-stock live next to the price on this page, so the photo only carries «تازه» / «ناموجود»
  const badge = detailBadgeHtml(p, soldOut, false, false, discountPct);
  const images = p.images && p.images.length > 0 ? p.images : [];
  const hasImages = images.length > 0;
  const hasMultiImages = images.length > 1;
  const hasVariants = p.variants && p.variants.length > 0;
  const firstVariant = hasVariants ? p.variants[0] : null;
  const firstAvailable = hasVariants && firstVariant.available;
  const firstStatus = hasVariants ? variantStatusHtml(firstVariant) : { text: '', cls: '' };
  const priceHtmlStr = priceHtml(p, firstVariant, 'detail-price', 'detail-price-el');
  const variantSelect = hasVariants ? `
      <select class="variant-select" id="detail-variant-select" ${soldOut?'disabled':''} onchange="onDetailVariantChange()">
        ${p.variants.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(variantOptionLabel(v))}</option>`).join('')}
      </select>
      <p class="variant-status ${firstStatus.cls}" id="detail-variant-status" style="display:${firstStatus.text ? 'block' : 'none'};">${firstStatus.text}</p>` : '';
  const buyDisabled = soldOut || (hasVariants && !firstAvailable);

  const variantChips = hasVariants ? `<div class="pd-variants" role="radiogroup" aria-label="انتخاب مدل">
      <div class="pd-label">انتخاب رنگ / مدل</div>
      <div class="pd-chips">${p.variants.map((v, i) => `<button type="button" class="pd-chip${i === 0 ? ' on' : ''}${v.available ? '' : ' off'}" data-v="${escapeHtml(v.name)}" onclick="pickDetailVariant(this)">${escapeHtml(v.name)}</button>`).join('')}</div>
    </div>` : '';
  const wishActive = wishlistIds.has(p.id);
  document.getElementById('pdHeadTitle').textContent = p.name;
  document.getElementById('pdHeadActions').innerHTML = `
    <button type="button" class="pd-icon" onclick="shareProduct(${p.id}, this)" aria-label="اشتراک‌گذاری"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg></button>
    <button type="button" class="pd-icon pd-heart${wishActive ? ' active' : ''}" id="pdHeart" onclick="pdToggleWish(${p.id})" aria-label="علاقه‌مندی"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.5-9C1 7.5 2.8 4 6.2 4c2 0 3.4 1.1 4.3 2.4C11.4 5.1 12.8 4 14.8 4 18.2 4 20 7.5 18.5 11c-2.5 4.6-9.5 9-9.5 9z"/></svg></button>
    <button type="button" class="pd-icon pd-cart" id="pdCartBtn" onclick="openDrawer()" aria-label="سبد خرید"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg><span class="pd-cart-n" id="pdCartCount"></span></button>`;
  syncPdCartCount();

  document.getElementById('productBody').innerHTML = `
    <div class="pd">
      <div class="pd-gallery">
        <div class="detail-visual" id="detailVisual">
          ${badge}
          ${hasImages ? `<img src="${escapeHtml(images[detailImageIndex])}" alt="${escapeHtml(p.name)}" class="detail-photo" id="detailImg" onclick="openZoom(detailImageIndex)"><span class="pd-zoom-hint" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8.5v5M8.5 11h5"/></svg></span>` : icons[p.icon]}
          ${hasMultiImages ? `
            <button class="img-nav right" onclick="changeDetailImage(1)" aria-label="عکس بعدی"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg></button>
            <span class="pd-counter" id="pdCounter">${toFa(detailImageIndex + 1)} / ${toFa(images.length)}</span>
          ` : ''}
        </div>
        ${hasMultiImages ? `<div class="pd-thumbs">${images.map((src, i) => `<button type="button" class="pd-thumb${i === detailImageIndex ? ' on' : ''}" onclick="setDetailImage(${i})" aria-label="عکس ${toFa(i + 1)}"><img src="${escapeHtml(thumbUrl(src))}" alt="" loading="lazy" onerror="thumbFallback(this)"></button>`).join('')}</div>` : ''}
      </div>
      <div class="pd-info">
        <span class="detail-cat">${escapeHtml(p.catLabel)}</span>
        <h1 class="detail-name">${escapeHtml(p.name)}</h1>
        <div class="pd-price-row">${priceHtmlStr}${onSale && !soldOut ? `<span class="pd-off">${toFa(discountPct)}٪ تخفیف</span>` : ''}</div>
        ${p.saleEndsAt ? saleEndsText(p.saleEndsAt) : ''}
        ${lowStock ? `<p class="pd-stock">فقط ${toFa(p.stock)} عدد باقی مونده</p>` : ''}
        ${variantChips}
        <div class="pd-hidden-select">${variantSelect}</div>
        <div class="pd-buybar">
          <button class="buy-btn pd-buy" id="detail-buy-btn" onclick="addToCartDetail()" ${buyDisabled?'disabled':''}>${soldOut?'ناموجود':(buyDisabled?'ناموجود':'افزودن به سبد خرید')}</button>
        </div>
        <ul class="pd-trust">
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.8 5.4 3.4 8 8.8 8.8-5.4.8-8 3.4-8.8 8.8-.8-5.4-3.4-8-8.8-8.8 5.4-.8 8-3.4 8.8-8.8z"/></svg><span>ساخت دست<small>تولید محدود</small></span></li>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17.5" cy="17.5" r="1.6"/></svg><span>ارسال به سراسر کشور<small>پس‌کرایه، درب منزل</small></span></li>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span>پرداخت امن<small>درگاه زیبال</small></span></li>
        </ul>
        ${p.description ? `<div class="detail-desc"><div class="detail-desc-title">توضیحات محصول</div>${escapeHtml(p.description)}</div>` : ''}
      </div>
    </div>
    <div class="reviews-section">
      <div class="detail-desc-title">نظر خریداران</div>
      <div id="reviewsSummary" class="reviews-summary"></div>
      <div id="reviewsList"><p style="font-size:13px;color:var(--coffee-70);">در حال بارگذاری...</p></div>
      <div id="reviewFormWrap" style="margin-top:16px;"></div>
    </div>
  `;
  const vis = document.getElementById('detailVisual');
  if(hasMultiImages && vis){
    let x0 = null, y0 = null;
    vis.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    vis.addEventListener('touchend', e => {
      if(x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if(Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) changeDetailImage(dx < 0 ? 1 : -1);
      x0 = null;
    });
  }
}
function pickDetailVariant(btn){
  const sel = document.getElementById('detail-variant-select');
  if(!sel) return;
  sel.value = btn.dataset.v;
  document.querySelectorAll('.pd-chip').forEach(c => c.classList.toggle('on', c === btn));
  onDetailVariantChange();
}
function pdToggleWish(id){
  toggleWishlist(id);
  const h = document.getElementById('pdHeart');
  if(!h || !currentUser) return;
  const on = wishlistIds.has(id);
  h.classList.toggle('active', on);
  h.classList.remove('burst');
  if(on){ void h.offsetWidth; h.classList.add('burst'); }
}

function starsHtml(rating){
  let out = '';
  for(let i = 1; i <= 5; i++){
    out += `<svg width="14" height="14" viewBox="0 0 24 24" style="fill:${i<=Math.round(rating)?'var(--gold)':'none'};stroke:var(--gold);stroke-width:1.4;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>`;
  }
  return `<span class="review-item-stars" style="display:inline-flex;gap:2px;">${out}</span>`;
}

let selectedReviewRating = 0;
function renderReviewStarPicker(){
  const wrap = document.getElementById('reviewStarPicker');
  if(!wrap) return;
  wrap.innerHTML = [1,2,3,4,5].map(i => `
    <button type="button" class="${i<=selectedReviewRating?'active':''}" onclick="pickReviewStar(${i})">
      <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>
    </button>
  `).join('');
}
function pickReviewStar(i){
  selectedReviewRating = i;
  renderReviewStarPicker();
}

async function loadProductReviews(productId){
  const listEl = document.getElementById('reviewsList');
  const summaryEl = document.getElementById('reviewsSummary');
  const formWrapEl = document.getElementById('reviewFormWrap');
  if(!listEl) return;

  const { data: approved } = await db.from('reviews').select('*').eq('product_id', productId).eq('approved', true).order('created_at', { ascending: false });
  const reviews = approved || [];

  if(reviews.length === 0){
    listEl.innerHTML = '<p style="font-size:13px;color:var(--coffee-70);">هنوز نظری برای این محصول ثبت نشده.</p>';
    summaryEl.textContent = '';
  } else {
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
    summaryEl.innerHTML = `${starsHtml(avg)} <b style="color:var(--coffee);">${avg.toFixed(1)}</b> از ۵ (${toFa(reviews.length)} نظر)`;
    listEl.innerHTML = reviews.map(r => `
      <div class="review-item">
        <div class="review-item-top">
          <span class="review-item-name">${escapeHtml(r.author_name)}</span>
          <span class="review-item-date">${new Date(r.created_at).toLocaleDateString('fa-IR')}</span>
        </div>
        ${starsHtml(r.rating)}
        <div class="review-item-comment">${escapeHtml(r.comment)}</div>
      </div>
    `).join('');
  }

  if(!currentUser){
    formWrapEl.innerHTML = `<p class="review-status-note">برای ثبت نظر <a href="#" onclick="openAuthModal(); return false;" style="color:var(--coffee);">وارد حساب کاربری‌ات</a> شو.</p>`;
    return;
  }

  const { data: own } = await db.from('reviews').select('*').eq('product_id', productId).eq('user_id', currentUser.id).maybeSingle();
  if(own){
    formWrapEl.innerHTML = own.approved
      ? `<p class="review-status-note">نظر شما ثبت و نمایش داده شده.</p>`
      : `<p class="review-status-note">نظر شما ثبت شد و پس از تایید مدیر نمایش داده می‌شه.</p>`;
    return;
  }

  selectedReviewRating = 0;
  formWrapEl.innerHTML = `
    <div class="review-form">
      <div class="review-star-picker" id="reviewStarPicker"></div>
      <textarea id="reviewCommentInput" rows="3" maxlength="1000" placeholder="نظرت رو درباره‌ی این محصول بنویس..."></textarea>
      <p class="form-error" id="reviewFormError"></p>
      <button class="hero-btn" style="color:var(--coffee);border-color:var(--coffee);" onclick="submitReview(${productId})">ثبت نظر</button>
    </div>
  `;
  renderReviewStarPicker();
}

async function submitReview(productId){
  const errorEl = document.getElementById('reviewFormError');
  errorEl.classList.remove('show');
  const comment = document.getElementById('reviewCommentInput').value.trim();
  if(!selectedReviewRating || !comment){
    errorEl.textContent = 'امتیاز و متن نظر رو کامل کن.';
    errorEl.classList.add('show');
    return;
  }
  const authorName = (currentProfile && currentProfile.full_name) ? currentProfile.full_name : 'کاربر حنا گالری';
  const { error } = await db.from('reviews').insert({
    product_id: productId,
    user_id: currentUser.id,
    author_name: authorName,
    rating: selectedReviewRating,
    comment,
  });
  if(error){
    errorEl.textContent = 'مشکلی پیش اومد، دوباره امتحان کن.';
    errorEl.classList.add('show');
    return;
  }
  showToast('نظر شما ثبت شد');
  loadProductReviews(productId);
}

function openProductDetail(id){
  const p = products.find(p => p.id === id);
  if(!p) return;
  currentDetailProduct = p;
  detailImageIndex = 0;
  preloadImages(p.images);
  renderProductDetail();
  loadProductReviews(id);
  productPage.classList.add('open');
  productPage.scrollTop = 0;
  // the address bar now holds a link straight to this product (hanagalleryy.ir/#p80); a product's own page (/p/80/) keeps its address
  if(location.pathname.replace(/\/$/, '') === '/p/' + id){ if(location.hash) history.replaceState(null, '', location.pathname + location.search); }
  else if(location.hash !== '#p' + id) history.replaceState(null, '', storeBase() + location.search + '#p' + id);
  trackEvent('view', id);
}
function closeProductDetail(){
  productPage.classList.remove('open');
  hideAddedBar();
  if(/^#p\d+$/.test(location.hash) || /^\/p\//.test(location.pathname)) history.replaceState(null, '', storeBase() + location.search);
}
function productLink(id){ return location.origin + '/#p' + id; }
async function shareProduct(id, btn){
  const p = products.find(p => p.id === id);
  const url = productLink(id);
  if(navigator.share){
    try{ await navigator.share({ title: p ? p.name + ' | حنا گالری' : 'حنا گالری', url }); return; }
    catch(e){ if(e && e.name === 'AbortError') return; }
  }
  try{ await navigator.clipboard.writeText(url); showToast('لینک محصول کپی شد'); }
  catch(e){ showToast(url); }
}
// a shared or advertised link (…/#p80) opens that product as soon as the products are loaded
// the product and collection addresses search engines index (/p/26/, /c/necklace/) open the store itself
const PATH_ROUTE = location.pathname.match(/^\/(p|c)\/([a-z0-9]+)\/?$/);
function storeBase(){ return /^\/(p|c)\//.test(location.pathname) ? '/' : location.pathname; }
function openRouteFromPath(){
  if(!PATH_ROUTE) return;
  if(PATH_ROUTE[1] === 'p'){ const id = Number(PATH_ROUTE[2]); if(products.find(p => p.id === id)) openProductDetail(id); else history.replaceState(null, '', '/'); }
  else if(document.querySelector(`.filter-btn[data-cat="${PATH_ROUTE[2]}"]`)) enterCategoryFocus(PATH_ROUTE[2]);
}
function openProductFromHash(){
  const m = location.hash.match(/^#p(\d+)$/);
  if(!m) return;
  const id = Number(m[1]);
  if(products.find(p => p.id === id)){ if(!currentDetailProduct || currentDetailProduct.id !== id || !productPage.classList.contains('open')) openProductDetail(id); }
}
window.addEventListener('hashchange', openProductFromHash);
document.getElementById('productBackBtn').addEventListener('click', closeProductDetail);

function setDetailImage(idx){
  if(!currentDetailProduct || !currentDetailProduct.images) return;
  detailImageIndex = idx;
  const img = document.getElementById('detailImg');
  if(img) swapImageSrc(img, currentDetailProduct.images[idx]);
  preloadNextImage(currentDetailProduct.images, idx);
  const visual = document.getElementById('detailVisual');
  if(visual) visual.querySelectorAll('.img-dot').forEach((dot,i) => dot.classList.toggle('active', i===idx));
  document.querySelectorAll('.pd-thumb').forEach((t, i) => t.classList.toggle('on', i === idx));
  const counter = document.getElementById('pdCounter');
  if(counter) counter.textContent = toFa(idx + 1) + ' / ' + toFa(currentDetailProduct.images.length);
}
function changeDetailImage(dir){
  if(!currentDetailProduct || !currentDetailProduct.images || currentDetailProduct.images.length < 2) return;
  const len = currentDetailProduct.images.length;
  const idx = ((detailImageIndex||0) + dir + len) % len;
  setDetailImage(idx);
}

function onDetailVariantChange(){
  const p = currentDetailProduct;
  if(!p || !p.variants) return;
  const sel = document.getElementById('detail-variant-select');
  const statusEl = document.getElementById('detail-variant-status');
  const btn = document.getElementById('detail-buy-btn');
  const priceEl = document.getElementById('detail-price-el');
  const chosen = p.variants.find(v => v.name === sel.value);
  if(!chosen) return;
  const status = variantStatusHtml(chosen);
  statusEl.textContent = status.text;
  statusEl.className = 'variant-status' + (status.cls ? ' ' + status.cls : '');
  statusEl.style.display = status.text ? 'block' : 'none';
  btn.disabled = !chosen.available;
  btn.textContent = chosen.available ? 'افزودن به سبد خرید' : 'ناموجود';
  if(priceEl) priceEl.outerHTML = priceHtml(p, chosen, 'detail-price', 'detail-price-el');
}

function addToCartDetail(){
  const p = currentDetailProduct;
  if(!p) return;
  let variant = null;
  let chosen = null;
  if(p.variants && p.variants.length > 0){
    const sel = document.getElementById('detail-variant-select');
    variant = sel ? sel.value : p.variants[0].name;
    chosen = p.variants.find(v => v.name === variant);
    if(chosen && !chosen.available) return;
  }
  if(!canAddOne(p, variant)) return;
  const existing = cart.find(i=>i.id===p.id && i.variant===variant);
  if(existing){ existing.qty++; }
  else { cart.push({...p, price: priceForVariant(p, chosen), qty:1, variant}); }
  trackEvent('cart', p.id);
  cartJustAdded = p.id + '|' + variant;
  // the customer stays on the product page; a bar confirms it and opens the cart if they want
  flyToCart(document.querySelector('#productPage .detail-photo'), () => { updateCart(); showAddedBar(p); });
}

// کلیک روی هر کارت محصول (به‌جز دکمه‌ها/سلکت/اسلایدر عکس) → باز شدن صفحه‌ی جزئیات محصول
document.addEventListener('click', e => {
  if(e.target.closest('button, select, .img-nav, .img-dot')) return;
  const card = e.target.closest('.product-grid .card');
  if(!card) return;
  const id = parseInt(card.dataset.id, 10);
  if(!isNaN(id)) openProductDetail(id);
});


const newestGrid = document.getElementById('newestGrid');
function renderNewest(){
  const newest = [...products].sort((a,b) => b.id - a.id).slice(0, 4);
  newestGrid.innerHTML = newest.map(productCardHtml).join('');
  observeCardPreloads();
}

const saleGrid = document.getElementById('saleGrid');
const saleSection = document.getElementById('saleSection');
function renderSaleProducts(){
  const onSaleProducts = products.filter(p => p.salePrice !== null && p.salePrice !== undefined);
  if(onSaleProducts.length === 0){
    saleSection.style.display = 'none';
    return;
  }
  saleSection.style.display = 'block';
  saleGrid.innerHTML = onSaleProducts.map(productCardHtml).join('');
  observeCardPreloads();
}

function sortProducts(list){
  const sorted = [...list];
  if(currentSort === 'price_asc') sorted.sort((a,b) => a.effectivePrice - b.effectivePrice);
  else if(currentSort === 'price_desc') sorted.sort((a,b) => b.effectivePrice - a.effectivePrice);
  else sorted.sort((a,b) => b.id - a.id); // جدیدترین
  return sorted;
}
function renderProducts(cat){
  const normedCat = normCat(cat);
  const filtered = sortProducts(products.filter(p => (normedCat==='all' || p.cat===normedCat) && (!currentSearch || normFa(p.name).includes(normFa(currentSearch)))));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if(currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  grid.innerHTML = pageItems.map(productCardHtml).join('');
  observeCardPreloads();
  renderPagination(totalPages);
}

function renderPagination(totalPages){
  if(totalPages <= 1){ paginationEl.innerHTML = ''; return; }
  let html = '';
  for(let i = 1; i <= totalPages; i++){
    html += `<button class="page-btn${i===currentPage?' active':''}" data-page="${i}">${toFa(i)}</button>`;
  }
  paginationEl.innerHTML = html;
}

paginationEl.addEventListener('click', e => {
  const btn = e.target.closest('.page-btn');
  if(!btn) return;
  currentPage = parseInt(btn.dataset.page, 10);
  renderProducts(currentCat);
  grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
fetchProducts().then(() => { openRouteFromPath(); openProductFromHash(); });

const scrollRevealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if(entry.isIntersecting){
      entry.target.classList.add('revealed');
      scrollRevealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal-on-scroll').forEach(el => scrollRevealObserver.observe(el));

// product cards rise in as they scroll into view, once per grid
(function(){
  if(!('IntersectionObserver' in window) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  const seen = new Set();
  const io = new IntersectionObserver(entries => {
    let k = 0;
    entries.forEach(e => {
      if(!e.isIntersecting) return;
      const el = e.target;
      el.style.transitionDelay = (k++ * 90) + 'ms';
      el.classList.add('in');
      seen.add(el.dataset.key);
      io.unobserve(el);
      setTimeout(() => { el.style.transitionDelay = ''; }, 1400);
    });
  }, { threshold: .12, rootMargin: '0px 0px -30px 0px' });
  const tag = grid => grid.querySelectorAll('.card[data-id]').forEach(c => {
    const key = grid.id + ':' + c.dataset.id;
    c.dataset.key = key;
    if(seen.has(key)) return;
    c.classList.add('rv');
    io.observe(c);
  });
  ['newestGrid', 'saleGrid', 'productGrid', 'wishlistGrid'].forEach(id => {
    const g = document.getElementById(id);
    if(!g) return;
    tag(g);
    new MutationObserver(() => tag(g)).observe(g, { childList: true });
  });
})();

const heroDecoEl = document.getElementById('heroDeco');
if(heroDecoEl){
  const heroSectionEl = heroDecoEl.closest('.hero');
  const onHeroScroll = () => {
    const rect = heroSectionEl.getBoundingClientRect();
    const progress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
    heroDecoEl.style.transform = `translateY(${(progress - 0.5) * 60}px)`;
  };
  window.addEventListener('scroll', onHeroScroll, { passive: true });
  onHeroScroll();
}

function toFaDigits(str){
  const map = { '0':'۰','1':'۱','2':'۲','3':'۳','4':'۴','5':'۵','6':'۶','7':'۷','8':'۸','9':'۹' };
  return String(str).replace(/[0-9]/g, d => map[d]);
}
async function loadTestimonials(){
  const section = document.getElementById('testimonials');
  const { data } = await db.from('reviews').select('*, products(name)').eq('approved', true).order('created_at', { ascending: false }).limit(3);
  if(!data || data.length === 0){
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  document.getElementById('testimonialsGrid').innerHTML = data.map(r => `
    <div class="testimonial-card reveal-on-scroll revealed">
      ${starsHtml(r.rating)}
      <p>${escapeHtml(r.comment)}</p>
      <div class="t-author">${escapeHtml(r.author_name)}${r.products ? ' · ' + escapeHtml(r.products.name) : ''}</div>
    </div>
  `).join('');
}
loadTestimonials();

const heroStatsEl = document.getElementById('heroStats');
if(heroStatsEl){
  const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        const start = performance.now();
        const duration = 1400;
        const targets = { orders: 200, rating: 4.9, handmade: 100 };
        const step = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          document.getElementById('heroStatOrders').textContent = '+' + toFaDigits(Math.round(targets.orders * eased));
          document.getElementById('heroStatRating').textContent = toFaDigits((targets.rating * eased).toFixed(1)) + ' / ۵';
          document.getElementById('heroStatHandmade').textContent = toFaDigits(Math.round(targets.handmade * eased)) + '٪';
          if(t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        statsObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });
  statsObserver.observe(heroStatsEl);
}

let currentCat = null; // null یعنی هنوز دسته‌ای انتخاب نشده (حالت صفحه اصلی)
document.getElementById('filterRow').addEventListener('click', e=>{
  const btn = e.target.closest('.filter-btn');
  if(!btn) return;
  enterCategoryFocus(btn.dataset.cat);
});

function isCategoryFocused(){
  return document.getElementById('categoryResults').style.display !== 'none';
}
function updateCategoryBanner(cat){
  const normedCat = normCat(cat);
  const count = products.filter(p => (normedCat==='all' || p.cat===normedCat) && (!currentSearch || normFa(p.name).includes(normFa(currentSearch)))).length;
  const btn = document.querySelector(`.filter-btn[data-cat="${cat}"]`);
  document.getElementById('cfbCount').textContent = toFa(count);
  document.getElementById('cfbName').textContent = btn ? btn.textContent : '';
  const art = btn && btn.querySelector('.cat-art');
  document.getElementById('cfbArt').innerHTML = art ? art.outerHTML : '';
}
function enterCategoryFocus(cat){
  const wasFocused = isCategoryFocused();
  currentCat = cat;
  currentPage = 1;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active', b.dataset.cat===cat));
  document.getElementById('newestSection').style.display = 'none';
  saleSection.style.display = 'none';
  document.getElementById('categoryFocusBanner').style.display = 'grid';
  document.getElementById('categoryResults').style.display = 'block';
  renderProducts(cat);
  updateCategoryBanner(cat);
  if(!wasFocused) document.getElementById('categoryFocusBanner').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function showHomeSections(){
  document.getElementById('categoryFocusBanner').style.display = 'none';
  document.getElementById('categoryResults').style.display = 'none';
  document.getElementById('newestSection').style.display = 'block';
  renderSaleProducts();
}
function exitCategoryFocus(){
  if(/^\/c\//.test(location.pathname)) history.replaceState(null, '', '/' + location.search + location.hash);
  currentCat = null;
  currentSearch = '';
  currentSort = 'newest';
  document.getElementById('sortSelect').value = 'newest';
  syncSortButtons();
  searchInput.value = '';
  searchBar.classList.remove('open');
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  showHomeSections();
  document.getElementById('shop').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.getElementById('cfbBackBtn').addEventListener('click', exitCategoryFocus);
function syncSortButtons(){
  const v = document.getElementById('sortSelect').value;
  document.querySelectorAll('.cfb-sort button').forEach(b => b.classList.toggle('on', b.dataset.sort === v));
}
document.querySelectorAll('.cfb-sort button').forEach(b => b.addEventListener('click', () => {
  const sel = document.getElementById('sortSelect');
  if(sel.value === b.dataset.sort) return;
  sel.value = b.dataset.sort;
  sel.dispatchEvent(new Event('change'));
}));
document.getElementById('sortSelect').addEventListener('change', () => {
  syncSortButtons();
  currentSort = document.getElementById('sortSelect').value;
  currentPage = 1;
  if(currentCat) renderProducts(currentCat);
});

// while a page, drawer, menu or sheet is open the page behind must not scroll
(function(){
  const pages = [...document.querySelectorAll('.product-page, .checkout-page')];
  const others = [...document.querySelectorAll('.drawer, .mobile-nav, .auth-modal, .account-panel, .vpn-modal, .zoom-view')];
  const sync = () => {
    const pageOpen = pages.some(el => el.classList.contains('open'));
    document.documentElement.classList.toggle('layer-open', pageOpen);
    document.documentElement.classList.toggle('locked', pageOpen || others.some(el => el.classList.contains('open')));
  };
  const mo = new MutationObserver(sync);
  pages.concat(others).forEach(el => mo.observe(el, { attributes: true, attributeFilter: ['class'] }));
  sync();
})();

// منو (موبایل)
const menuToggleBtn = document.getElementById('menuToggleBtn');
const mobileNav = document.getElementById('mobileNav');
const menuOverlay = document.getElementById('menuOverlay');
function setMenu(open){
  if(open){
    // category tiles reuse the same line-art icons as the homepage circles
    const cats = document.getElementById('mnCats');
    if(cats && !cats.children.length){
      cats.innerHTML = [...document.querySelectorAll('#filterRow .filter-btn')].map(b =>
        `<button type="button" class="mn-cat" data-cat="${b.dataset.cat}">${(b.querySelector('.cat-art') || {}).outerHTML || ''}<span>${escapeHtml(b.textContent.trim())}</span></button>`).join('');
      cats.querySelectorAll('.mn-cat').forEach(c => c.addEventListener('click', () => {
        setMenu(false);
        enterCategoryFocus(c.dataset.cat);
        document.getElementById('categoryFocusBanner').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
    }
    document.getElementById('mnUserName').textContent = currentUser ? ('سلام، ' + loginLinkBtn.textContent.trim()) : 'ورود و ثبت‌نام';
    document.getElementById('mnUserSub').textContent = currentUser ? 'حساب کاربری و تنظیمات' : 'برای سفارش و پیگیری وارد شو';
    document.getElementById('searchBar').classList.remove('open');
  }
  mobileNav.classList.toggle('open', open);
  menuOverlay.classList.toggle('open', open);
  menuToggleBtn.classList.toggle('x', open);
  menuToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
menuToggleBtn.addEventListener('click', () => setMenu(!mobileNav.classList.contains('open')));
menuOverlay.addEventListener('click', () => setMenu(false));
document.getElementById('mnClose').addEventListener('click', () => setMenu(false));
document.getElementById('mnBrand').addEventListener('click', e => { e.preventDefault(); setMenu(false); window.scrollTo({ top: 0, behavior: 'smooth' }); });
mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
document.getElementById('mnOrders').addEventListener('click', e => { e.preventDefault(); if(currentUser) document.getElementById('viewOrdersBtn').click(); else openAuthModal(); });
document.getElementById('mnWishlist').addEventListener('click', e => { e.preventDefault(); if(currentUser) document.getElementById('viewWishlistBtn').click(); else openAuthModal(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape' && mobileNav.classList.contains('open')) setMenu(false); });

// جستجو
const searchToggleBtn = document.getElementById('searchToggleBtn');
const searchBar = document.getElementById('searchBar');
const searchInput = document.getElementById('searchInput');
searchToggleBtn.addEventListener('click', () => {
  searchBar.classList.toggle('open');
  if(mobileNav.classList.contains('open')) setMenu(false);
  if(searchBar.classList.contains('open')) searchInput.focus();
});
searchInput.addEventListener('input', () => {
  currentSearch = searchInput.value.trim();
  currentPage = 1;
  if(currentSearch || currentCat){
    enterCategoryFocus(currentCat || 'all');
  } else {
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
    showHomeSections();
  }
});

// ---- cart vs. stock: the cart may never hold more than is in stock ----
// product stock is shared by all its variants; a variant with its own count is capped by that too
function variantQtyFromText(text, name){
  if(!text || !name) return null;
  for(const entry of text.split(/[,،]/)){
    const parts = entry.trim().split(':');
    if(parts.length < 2 || parts[0].trim() !== name) continue;
    const rest = parts[1].trim();
    if(rest === 'ناموجود') return 0;
    const n = parseInt(rest, 10);
    return isNaN(n) ? null : n;
  }
  return null;
}
function lineLimit(p, variant){
  const stock = Math.max(0, Number(p.stock) || 0);
  const otherLines = cart.filter(i => i.id === p.id && i.variant !== variant).reduce((s, i) => s + i.qty, 0);
  let limit = Math.max(0, stock - otherLines);
  const v = variant ? (p.variants || []).find(v => v.name === variant) : null;
  if(v && v.qty !== null) limit = Math.min(limit, Math.max(0, v.qty));
  return limit;
}
function stockWarning(p, variant, limit){
  const label = `«${p.name}${variant ? ' - ' + variant : ''}»`;
  return limit > 0 ? `از ${label} فقط ${toFa(limit)} عدد موجوده.` : `${label} دیگه موجودی نداره.`;
}
// returns true if one more fits; otherwise warns and returns false
function canAddOne(p, variant){
  const line = cart.find(i => i.id === p.id && i.variant === variant);
  const limit = lineLimit(p, variant);
  if((line ? line.qty : 0) + 1 <= limit) return true;
  showToast(stockWarning(p, variant, limit));
  return false;
}

function addToCart(id, el){
  const p = products.find(p=>p.id===id);
  let variant = null;
  let chosen = null;
  if(p && p.variants && p.variants.length > 0){
    const card = el && el.closest('.card');
    const sel = card ? card.querySelector('.variant-select') : null;
    variant = sel ? sel.value : p.variants[0].name;
    chosen = p.variants.find(v => v.name === variant);
    if(chosen && !chosen.available) return; // احتیاطی: این گزینه ناموجوده
  }
  if(!p || !canAddOne(p, variant)){ if(p) openDrawer(); return; }
  const existing = cart.find(i=>i.id===id && i.variant===variant);
  if(existing){ existing.qty++; }
  else { cart.push({...p, price: priceForVariant(p, chosen), qty:1, variant}); }
  trackEvent('cart', p.id);
  cartJustAdded = id + '|' + variant;
  const card = el && el.closest('.card');
  flyToCart(card && card.querySelector('.card-photo'), () => { updateCart(); openDrawer(); });
}
let cartJustAdded = null, cartBumpIdx = -1;
// the product photo shrinks into the cart icon, then the badge pops
function flyToCart(img, done){
  const target = (productPage.classList.contains('open') && document.getElementById('pdCartBtn')) || document.getElementById('cartOpenBtn');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!img || !target || reduce || !img.complete){ done(); return; }
  const a = img.getBoundingClientRect(), b = target.getBoundingClientRect();
  if(!a.width || a.bottom < 0 || a.top > innerHeight){ done(); return; }
  const ghost = img.cloneNode(false);
  ghost.removeAttribute('onerror');
  ghost.className = 'fly-ghost';
  Object.assign(ghost.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = ghost.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '4px' },
    { transform: `translate(${dx * .55}px,${dy * .35 - 60}px) scale(.5)`, opacity: 1, borderRadius: '30%', offset: .55 },
    { transform: `translate(${dx}px,${dy}px) scale(.08)`, opacity: .4, borderRadius: '50%' }
  ], { duration: 650, easing: 'cubic-bezier(.5,0,.3,1)' });
  let finished = false;
  const finish = () => {
    if(finished) return; finished = true;
    ghost.remove();
    target.classList.remove('cart-hit'); void target.offsetWidth; target.classList.add('cart-hit');
    done();
  };
  anim.onfinish = finish;
  setTimeout(finish, 900);
}
function changeQty(id, delta, variant){
  const item = cart.find(i=>i.id===id && i.variant===(variant || null));
  if(!item) return;
  if(delta > 0){
    const p = products.find(p => p.id === id) || item;
    if(!canAddOne(p, item.variant)) return;
  }
  item.qty += delta;
  if(item.qty<=0) cart = cart.filter(i=>i !== item);
  updateCart();
}
function changeQtyAt(idx, delta){
  const item = cart[idx];
  if(!item) return;
  cartBumpIdx = idx;
  changeQty(item.id, delta, item.variant);
}
// the row slides away and collapses, then leaves the cart
function removeCartLine(idx, btn){
  const row = btn.closest('.drawer-item');
  const item = cart[idx];
  if(!row || !item){ return; }
  row.style.height = row.offsetHeight + 'px';
  requestAnimationFrame(() => row.classList.add('leaving'));
  setTimeout(() => changeQty(item.id, -item.qty, item.variant), 380);
}
function animateNumber(el, to, suffix){
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if(from === to || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)){ el.textContent = toFa(to) + suffix; return; }
  const t0 = performance.now(), dur = 450;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = toFa(Math.round(from + (to - from) * e)) + suffix;
    if(k < 1 && el.dataset.v == to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function syncPdCartCount(){
  const el = document.getElementById('pdCartCount');
  if(!el) return;
  const count = cart.reduce((s, i) => s + i.qty, 0);
  el.textContent = toFa(count);
  el.hidden = !count;
}
function updateCart(){
  const count = cart.reduce((s,i)=>s+i.qty,0);
  document.getElementById('cartCount').textContent = toFa(count);
  syncPdCartCount();
  const itemsEl = document.getElementById('drawerItems');
  if(cart.length===0){
    itemsEl.innerHTML = `<div class="drawer-empty">
      <svg viewBox="0 0 64 64" aria-hidden="true"><path class="l" d="M14 22h36l-3 32H17z"/><path class="l" d="M24 22v-4a8 8 0 0 1 16 0v4"/><path class="g" d="M32 33c2.6 3.4 4.3 5.7 4.3 7.8 0 2.4-1.9 4.2-4.3 4.2s-4.3-1.8-4.3-4.2c0-2.1 1.7-4.4 4.3-7.8z"/></svg>
      <b>سبد خریدت هنوز خالیه</b>
      <span>یه سر به جدیدترین کارهای دست‌ساز حنا گالری بزن.</span>
      <button type="button" onclick="closeDrawer(); document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });">مشاهده‌ی محصولات</button>
    </div>`;
  } else {
    itemsEl.innerHTML = cart.map((i, idx)=>{
      const atLimit = i.qty >= lineLimit(products.find(p => p.id === i.id) || i, i.variant);
      return `
      <div class="drawer-item${cartJustAdded === i.id + '|' + i.variant ? ' just-added' : ''}" style="--i:${idx}">
        <div class="mini-visual" style="background:${i.imageUrl ? '#fff' : i.bg}">${i.imageUrl ? `<img src="${escapeHtml(thumbUrl(i.imageUrl))}" alt="${escapeHtml(i.name)}" style="width:100%;height:100%;object-fit:cover;" onerror="thumbFallback(this)">` : icons[i.icon]}</div>
        <div class="drawer-item-info">
          <div class="di-top">
            <div class="name">${escapeHtml(i.name)}</div>
            <button class="di-remove" onclick="removeCartLine(${idx}, this)" aria-label="حذف ${escapeHtml(i.name)} از سبد"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button>
          </div>
          ${i.variant ? `<span class="di-variant">${escapeHtml(i.variant)}</span>` : ''}
          <div class="di-bottom">
            <div class="qty-ctrl">
              <button onclick="changeQtyAt(${idx},-1)" aria-label="کم کردن">−</button>
              <span${idx === cartBumpIdx ? ' class="bump"' : ''}>${toFa(i.qty)}</span>
              <button onclick="changeQtyAt(${idx},1)"${atLimit ? ' class="at-limit" aria-disabled="true"' : ''} aria-label="اضافه کردن">+</button>
            </div>
            <div class="price">${toFa(i.price * i.qty)} <small>تومان</small></div>
          </div>
          ${atLimit ? '<div class="stock-limit-note">حداکثر موجودی</div>' : ''}
        </div>
      </div>
    `;}).join('');
  }
  const total = cart.reduce((s,i)=>s+i.price*i.qty,0);
  animateNumber(document.getElementById('drawerTotal'), total, ' تومان');
  cartJustAdded = null; cartBumpIdx = -1;
  document.getElementById('drawerCount').textContent = count ? toFa(count) + ' محصول' : '';
  document.getElementById('drawerFoot').hidden = cart.length === 0;
  const proceedBtn = document.getElementById('proceedCheckoutBtn');
  proceedBtn.disabled = cart.length === 0;
  proceedBtn.textContent = currentUser ? 'تکمیل خرید' : 'ورود و تکمیل خرید';
}
updateCart();

const drawer = document.getElementById('drawer');
const overlay = document.getElementById('overlay');
function openDrawer(){
  if(!drawer.classList.contains('open')){
    drawer.classList.remove('anim-in'); void drawer.offsetWidth; drawer.classList.add('anim-in');
    clearTimeout(drawer._animT); drawer._animT = setTimeout(() => drawer.classList.remove('anim-in'), 1200);
  }
  drawer.classList.add('open'); overlay.classList.add('open');
  hideAddedBar();
}
function closeDrawer(){ drawer.classList.remove('open'); overlay.classList.remove('open'); }
// «added to cart» bar on the product page
let addedBarT = null;
function hideAddedBar(){ clearTimeout(addedBarT); document.getElementById('addedBar').classList.remove('show'); }
function showAddedBar(p){
  const bar = document.getElementById('addedBar');
  const n = cart.reduce((a, i) => a + i.qty, 0);
  const src = p.thumbs && p.thumbs[0];
  document.getElementById('addedBarImg').innerHTML = src ? `<img src="${src}" alt="" onerror="thumbFallback(this)">` : '';
  document.getElementById('addedBarCount').textContent = `${toFa(n)} محصول در سبد`;
  bar.classList.remove('show'); void bar.offsetWidth; bar.classList.add('show');
  clearTimeout(addedBarT); addedBarT = setTimeout(hideAddedBar, 5000);
}
document.getElementById('addedBarGo').addEventListener('click', () => { hideAddedBar(); openDrawer(); });
document.getElementById('cartOpenBtn').addEventListener('click', openDrawer);
document.getElementById('drawerClose').addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);

/* ================= صفحه‌ی تکمیل سفارش (جدا از سبد خرید) ================= */
const checkoutPage = document.getElementById('checkoutPage');
let appliedCoupon = null; // { code, discount_type, discount_value }
function getCartSubtotal(){
  return cart.reduce((s,i)=>s+i.price*i.qty,0);
}
function getDiscountAmount(){
  if(!appliedCoupon) return 0;
  const subtotal = getCartSubtotal();
  const discount = appliedCoupon.discount_type === 'percent'
    ? Math.round(subtotal * appliedCoupon.discount_value / 100)
    : appliedCoupon.discount_value;
  return Math.min(discount, subtotal);
}
function renderCheckoutSummary(){
  const summaryEl = document.getElementById('checkoutSummary');
  const subtotal = getCartSubtotal();
  const discount = getDiscountAmount();
  const total = subtotal - discount;
  let html = cart.map(i => `
    <div class="checkout-summary-item">
      <span>${escapeHtml(i.name)}${i.variant ? ` <span style="color:var(--gold);">(${escapeHtml(i.variant)})</span>` : ''} × ${toFa(i.qty)}</span>
      <span>${toFa(i.price * i.qty)} تومان</span>
    </div>
  `).join('');
  if(discount > 0){
    html += `<div class="checkout-summary-item"><span>تخفیف (${escapeHtml(appliedCoupon.code)})</span><span>- ${toFa(discount)} تومان</span></div>`;
  }
  html += `<div class="checkout-summary-total"><span>جمع کل (بدون هزینه‌ی ارسال)</span><span>${toFa(total)} تومان</span></div>`;
  html += `<p class="ship-fee-note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17.5" cy="17.5" r="1.6"/></svg><span>هزینه‌ی ارسال به عهده‌ی خریداره و موقع تحویل، درب منزل پرداخت می‌شه (پس‌کرایه).</span></p>`;
  summaryEl.innerHTML = html;
}
function resetCouponState(){
  appliedCoupon = null;
  document.getElementById('couponInput').value = '';
  const msgEl = document.getElementById('couponMsg');
  msgEl.textContent = '';
  msgEl.className = 'coupon-msg';
}
document.getElementById('applyCouponBtn').addEventListener('click', async () => {
  const msgEl = document.getElementById('couponMsg');
  const codeRaw = document.getElementById('couponInput').value.trim();
  if(!codeRaw){
    msgEl.textContent = 'یه کد وارد کن.';
    msgEl.className = 'coupon-msg err';
    return;
  }
  const code = codeRaw.toUpperCase();
  const { data: rows, error: couponErr } = await db.rpc('check_coupon', { p_code: code });
  const data = rows && rows[0];
  if(couponErr || !data || data.status !== 'ok'){
    appliedCoupon = null;
    const why = { expired: 'این کد تخفیف منقضی شده.', used_up: 'ظرفیت استفاده از این کد تموم شده.', already_used: 'شما قبلاً از این کد تخفیف استفاده کردی؛ هر نفر فقط یک بار می‌تونه ازش استفاده کنه.' };
    msgEl.textContent = couponErr ? 'بررسی کد ممکن نشد، دوباره امتحان کن.' : (why[data && data.status] || 'این کد تخفیف معتبر نیست.');
    msgEl.className = 'coupon-msg err';
    renderCheckoutSummary();
    return;
  }
  appliedCoupon = { code: data.code, discount_type: data.discount_type, discount_value: Number(data.discount_value) };
  msgEl.textContent = 'کد تخفیف اعمال شد.';
  msgEl.className = 'coupon-msg ok';
  renderCheckoutSummary();
});
document.getElementById('couponInput').addEventListener('input', () => {
  if(appliedCoupon){
    appliedCoupon = null;
    const msgEl = document.getElementById('couponMsg');
    msgEl.textContent = '';
    msgEl.className = 'coupon-msg';
    renderCheckoutSummary();
  }
});
// ordering needs a signed-in customer: ask for login first, then continue to checkout with the same cart
let pendingCheckout = false;
function requireLoginForCheckout(){
  pendingCheckout = true;
  closeDrawer();
  closeCheckoutPage();
  openAuthModal();
  document.getElementById('authCheckoutNote').style.display = 'block';
}
async function resumeCheckoutIfPending(){
  if(!pendingCheckout) return;
  pendingCheckout = false;
  document.getElementById('authCheckoutNote').style.display = 'none';
  const { data } = await db.auth.getSession();
  if(!data || !data.session || cart.length === 0) return;
  currentUser = data.session.user;
  if(!currentProfile) await loadProfile();
  openCheckoutPage();
}
function openCheckoutPage(){
  if(cart.length === 0) return;
  if(!currentUser){ requireLoginForCheckout(); return; }
  closeDrawer();
  resetCouponState();
  document.getElementById('checkoutSummary').style.display = 'block';
  document.getElementById('checkoutForm').style.display = 'block';
  document.getElementById('orderSuccess').style.display = 'none';
  document.getElementById('manualToggle').hidden = !isAdmin;
  document.getElementById('manualOrderOn').checked = false;
  applyManualMode();
  renderCheckoutSummary();
  updatePayLabels();
  if(currentProfile){
    document.getElementById('custName').value = currentProfile.full_name || '';
    document.getElementById('custAddress').value = currentProfile.address || '';
  }
  document.getElementById('custPhone').value = (currentProfile && currentProfile.phone && normalizeIranMobile(currentProfile.phone))
    || normalizeIranMobile(currentUser.phone) || '';
  checkoutPage.classList.add('open');
  checkoutPage.scrollTop = 0;
}
function closeCheckoutPage(){ checkoutPage.classList.remove('open'); }

// ---- manual order (admins only): an order taken in an Instagram DM, put together in the normal cart ----
// no customer details, no gateway; the server (admin_place_order) prices it, takes the stock and counts it in sales
function applyManualMode(){
  const on = manualOrderOn();
  document.getElementById('checkoutForm').classList.toggle('manual-on', on);
  document.getElementById('custNoteLabel').textContent = on ? 'یادداشت (اختیاری؛ مثلاً آیدی اینستای مشتری)' : 'یادداشت (اختیاری)';
  document.getElementById('custNote').placeholder = on ? 'مثلاً @username' : 'مثلاً درخواست طرح دلخواه';
  document.getElementById('formError').classList.remove('show');
  updatePayLabels();
}
document.getElementById('manualOrderOn').addEventListener('change', () => {
  if(manualOrderOn() && appliedCoupon){ resetCouponState(); renderCheckoutSummary(); }
  applyManualMode();
});
async function submitManualOrder(){
  const errorEl = document.getElementById('formError');
  const btn = document.getElementById('submitOrderBtn');
  btn.disabled = true;
  btn.textContent = 'در حال ثبت...';
  const { data, error } = await db.rpc('admin_place_order', {
    p_items: cart.map(i => ({ id: i.id, qty: i.qty, variant: i.variant || null })),
    p_name: '', p_phone: '', p_address: '', p_note: document.getElementById('custNote').value.trim() || null,
    p_pay: 'card', p_source: 'دایرکت اینستاگرام', p_discount: 0, p_sms: false,
  });
  btn.disabled = false;
  btn.textContent = submitBtnLabel();
  if(error || !data){
    console.error('manual order', error);
    errorEl.textContent = /HG_ADMIN/.test((error && error.message) || '') ? 'فقط مدیرها می‌تونن سفارش دستی ثبت کنن.' : orderErrorMessage(error);
    errorEl.classList.add('show');
    return;
  }
  logAdminAction('ثبت سفارش دستی', `کد ${data.tracking_code} — ${toFa(data.total)} تومان (دایرکت اینستاگرام)`);
  document.getElementById('custNote').value = '';
  cart = [];
  resetCouponState();
  updateCart();
  fetchProducts();
  showOrderResult({ title: 'سفارش دستی ثبت شد ✓', text: `مبلغ ${toFa(data.total)} تومان. موجودی کم شد و سفارش توی پنل مدیریت، بخش «منتظر ارسال» اومد.`, code: data.tracking_code });
}
document.getElementById('proceedCheckoutBtn').addEventListener('click', openCheckoutPage);
document.getElementById('checkoutBackBtn').addEventListener('click', () => { closeCheckoutPage(); openDrawer(); });
document.getElementById('backToShopBtn').addEventListener('click', () => { closeCheckoutPage(); if(productPage.classList.contains('open')) closeProductDetail(); });

// ثبت سفارش مستقیم داخل سایت (بدون نیاز به اینستاگرام)
function normalizeIranMobile(v){
  let d = String(v || '').replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
  if(/^00989\d{9}$/.test(d)) d = '0' + d.slice(4);
  else if(/^989\d{9}$/.test(d)) d = '0' + d.slice(2);
  else if(/^9\d{9}$/.test(d)) d = '0' + d;
  return /^09\d{9}$/.test(d) ? d : null;
}
function orderErrorMessage(error){
  const m = (error && error.message) || '';
  if(/HG_STOCK:/.test(m)) return `موجودی «${m.split('HG_STOCK:')[1].trim()}» کافی نیست. سبدت رو اصلاح کن و دوباره امتحان کن.`;
  if(/HG_GONE/.test(m)) return 'یکی از محصولات سبدت دیگه موجود نیست. سبد رو اصلاح کن.';
  if(/HG_COUPON_USED/.test(m)) return 'شما قبلاً از این کد تخفیف استفاده کردی؛ هر نفر فقط یک بار می‌تونه ازش استفاده کنه. کد حذف شد.';
  if(/HG_COUPON/.test(m)) return 'کد تخفیف دیگه معتبر نیست؛ حذف شد. دوباره «ثبت سفارش» رو بزن.';
  if(/HG_BAD_PHONE/.test(m)) return 'شماره موبایل رو درست وارد کن (مثل ۰۹۱۲۳۴۵۶۷۸۹).';
  if(/HG_BLOCKED/.test(m)) return 'ثبت سفارش برای این حساب امکان‌پذیر نیست. لطفاً با فروشگاه تماس بگیر.';
  if(/HG_TOO_MANY/.test(m)) return 'از این شماره چند سفارش پشت سر هم ثبت شده. چند دقیقه دیگه دوباره امتحان کن.';
  if(/HG_LOGIN/.test(m)) return 'برای ثبت سفارش اول وارد حسابت شو.';
  if(/HG_REQUIRED/.test(m)) return 'لطفاً فیلدهای ستاره‌دار (نام، شماره تماس و آدرس) رو پر کن.';
  return 'مشکلی پیش اومد، لطفاً دوباره امتحان کن.';
}

/* ================= پرداخت آنلاین (زیبال) ================= */
const PAY_PENDING = 'در انتظار پرداخت';
// off = کارت‌به‌کارت مثل قبل، test = فقط ادمین با درگاه آزمایشی زیبال، live = همه با درگاه واقعی
let paymentMode = 'off';
async function loadPaymentMode(){
  const { data } = await db.from('site_settings').select('value').eq('key', 'payment').maybeSingle();
  paymentMode = (data && data.value && data.value.mode) || 'off';
  updatePayLabels();
}
function onlinePaymentOn(){ return paymentMode === 'live' || (paymentMode === 'test' && isAdmin); }
function manualOrderOn(){ return isAdmin && document.getElementById('manualOrderOn').checked; }
function submitBtnLabel(){ return manualOrderOn() ? 'ثبت سفارش دستی' : onlinePaymentOn() ? 'ثبت سفارش و پرداخت' : 'ثبت سفارش'; }
function updatePayLabels(){
  const btn = document.getElementById('submitOrderBtn');
  if(!btn.disabled) btn.textContent = submitBtnLabel();
  document.getElementById('vpnNote').hidden = !onlinePaymentOn();
  document.getElementById('checkoutPayNote').textContent = onlinePaymentOn()
    ? 'پرداخت امن با درگاه زیبال و همه‌ی کارت‌های عضو شتاب. بعد از پرداخت به سایت برمی‌گردی و سفارشت قطعی می‌شه.'
      + (paymentMode === 'test' ? ' (حالت آزمایشی مدیر: پول واقعی کم نمی‌شه)' : '')
    : 'پرداخت به‌صورت کارت‌به‌کارت است؛ بعد از ثبت سفارش برای هماهنگی با شما تماس می‌گیریم.';
}
// ---- VPN: Iranian bank gateways only open on an Iranian connection ----
// the «geo» function answers true (Iran), false (abroad = VPN on) or null (couldn't tell; never block on that)
let netCheck = { at: 0, iran: null };
async function checkIranNet(fresh){
  if(!fresh && netCheck.at && Date.now() - netCheck.at < 5 * 60e3) return netCheck.iran;
  try{
    const { data } = await db.functions.invoke('geo', { method: 'GET' });
    netCheck = { at: Date.now(), iran: data && typeof data.iran === 'boolean' ? data.iran : null };
  }catch(e){ netCheck = { at: Date.now(), iran: null }; }
  return netCheck.iran;
}
let vpnResolve = null;
function setVpnModal(open){
  document.getElementById('vpnModal').classList.toggle('open', open);
  document.getElementById('vpnOverlay').classList.toggle('open', open);
}
// resolves true once the connection is Iranian (or can't be judged), false if the customer gives up
/* ================= بزرگ‌نمایی عکس محصول ================= */
const zoomView = document.getElementById('zoomView'), zvStage = document.getElementById('zvStage'), zvImg = document.getElementById('zvImg');
let zvIdx = 0, zs = 1, ztx = 0, zty = 0;
const zPts = new Map();
let zGesture = null, zLastTap = 0, zLastTapPos = null;
function zvImages(){ return (currentDetailProduct && currentDetailProduct.images) || []; }
function zvApply(anim){
  zvStage.classList.toggle('anim', !!anim);
  zvStage.classList.toggle('zoomed', zs > 1.01);
  zvImg.style.transform = `translate(${ztx}px, ${zty}px) scale(${zs})`;
}
function zvClamp(){
  const r = zvStage.getBoundingClientRect(), w = zvImg.offsetWidth * zs, h = zvImg.offsetHeight * zs;
  const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
  ztx = Math.min(mx, Math.max(-mx, ztx)); zty = Math.min(my, Math.max(-my, zty));
}
function zvReset(anim){ zs = 1; ztx = 0; zty = 0; zvApply(anim); }
function zvShow(i){
  const imgs = zvImages(); if(!imgs.length) return;
  zvIdx = (i + imgs.length) % imgs.length;
  zvImg.src = imgs[zvIdx];
  zvImg.alt = currentDetailProduct ? currentDetailProduct.name : '';
  document.getElementById('zvCount').textContent = imgs.length > 1 ? toFa(zvIdx + 1) + ' / ' + toFa(imgs.length) : '';
  document.getElementById('zvPrev').hidden = document.getElementById('zvNext').hidden = imgs.length < 2;
  zvReset(false);
}
function openZoom(i){
  if(!zvImages().length) return;
  zvShow(i || 0);
  zoomView.classList.add('open');
}
function closeZoom(){
  zoomView.classList.remove('open');
  if(zvIdx !== detailImageIndex) setDetailImage(zvIdx);
}
// zoom so the image point under (cx, cy) stays put
function zvZoomAt(ns, cx, cy, anim){
  const r = zvStage.getBoundingClientRect(), px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
  ns = Math.min(4, Math.max(1, ns));
  ztx = px - (px - ztx) * ns / zs; zty = py - (py - zty) * ns / zs; zs = ns;
  if(zs <= 1.01){ zs = 1; ztx = 0; zty = 0; }
  zvClamp(); zvApply(anim);
}
zvStage.addEventListener('pointerdown', e => {
  zvStage.setPointerCapture(e.pointerId);
  zPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if(zPts.size === 2){
    const [a, b] = [...zPts.values()];
    zGesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: zs, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx0: ztx, ty0: zty };
  } else if(zPts.size === 1){
    zGesture = { type: 'drag', x0: e.clientX, y0: e.clientY, tx0: ztx, ty0: zty, moved: false, t0: Date.now() };
  }
});
zvStage.addEventListener('pointermove', e => {
  if(!zPts.has(e.pointerId) || !zGesture) return;
  zPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if(zGesture.type === 'pinch' && zPts.size >= 2){
    const [a, b] = [...zPts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const r = zvStage.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ns = Math.min(4, Math.max(1, zGesture.s0 * d / zGesture.d0));
    // the image point that was under the fingers' midpoint follows the midpoint
    ztx = (mx - cx) - ((zGesture.mx - cx) - zGesture.tx0) * ns / zGesture.s0;
    zty = (my - cy) - ((zGesture.my - cy) - zGesture.ty0) * ns / zGesture.s0;
    zs = ns; zvClamp(); zvApply(false);
  } else if(zGesture.type === 'drag'){
    const dx = e.clientX - zGesture.x0, dy = e.clientY - zGesture.y0;
    if(Math.hypot(dx, dy) > 6) zGesture.moved = true;
    if(zs > 1){ ztx = zGesture.tx0 + dx; zty = zGesture.ty0 + dy; zvClamp(); zvApply(false); }
    else { zvImg.style.transform = `translate(${dx}px, ${Math.max(0, dy) * 0.6}px)`; zvImg.style.opacity = String(1 - Math.min(.5, Math.max(0, dy) / 400)); }
  }
});
function zvEnd(e){
  if(!zPts.has(e.pointerId)) return;
  zPts.delete(e.pointerId);
  const g = zGesture;
  if(g && g.type === 'pinch'){ if(zPts.size === 1){ const p = [...zPts.values()][0]; zGesture = { type: 'drag', x0: p.x, y0: p.y, tx0: ztx, ty0: zty, moved: true, t0: Date.now() }; } else { zGesture = null; if(zs < 1.05) zvReset(true); } return; }
  zGesture = null;
  if(!g) return;
  zvImg.style.opacity = '';
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if(!g.moved){
    const now = Date.now();
    const twice = now - zLastTap < 300 && zLastTapPos && Math.hypot(e.clientX - zLastTapPos.x, e.clientY - zLastTapPos.y) < 30;
    if(twice || e.pointerType === 'mouse'){ zvZoomAt(zs > 1.01 ? 1 : 2.5, e.clientX, e.clientY, true); zLastTap = 0; }
    else { zLastTap = now; zLastTapPos = { x: e.clientX, y: e.clientY }; }
    return;
  }
  if(zs > 1) return;
  if(dy > 110 && Math.abs(dy) > Math.abs(dx)){ closeZoom(); return; }
  if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && zvImages().length > 1){ zvShow(zvIdx + (dx < 0 ? 1 : -1)); return; }
  zvReset(true);
}
zvStage.addEventListener('pointerup', zvEnd);
zvStage.addEventListener('pointercancel', zvEnd);
zvStage.addEventListener('wheel', e => { e.preventDefault(); zvZoomAt(zs * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY, false); }, { passive: false });
document.getElementById('zvClose').addEventListener('click', closeZoom);
document.getElementById('zvPrev').addEventListener('click', () => zvShow(zvIdx - 1));
document.getElementById('zvNext').addEventListener('click', () => zvShow(zvIdx + 1));
document.addEventListener('keydown', e => {
  if(!zoomView.classList.contains('open')) return;
  if(e.key === 'Escape') closeZoom();
  else if(e.key === 'ArrowLeft') zvShow(zvIdx + 1);
  else if(e.key === 'ArrowRight') zvShow(zvIdx - 1);
});

/* ================= نصب سایت مثل اپ ================= */
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const inAppBrowser = /Instagram|FBAN|FBAV|Telegram|WhatsApp/i.test(ua);
const isMobile = isIOS || /Android/i.test(ua);
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });
window.addEventListener('appinstalled', () => { hideInstallBar(); document.getElementById('mnInstall').hidden = true; showToast('اپ حنا گالری نصب شد'); });
const SHARE_ICO = '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
const PLUS_ICO = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
function setInstModal(open){
  document.getElementById('instModal').classList.toggle('open', open);
  document.getElementById('instOverlay').classList.toggle('open', open);
}
async function startInstall(){
  hideInstallBar(true);
  if(installEvent){
    installEvent.prompt();
    try{ await installEvent.userChoice; }catch(e){}
    installEvent = null;
    return;
  }
  let intro = 'سه قدم ساده تا آیکون حنا گالری روی صفحه‌ی گوشیت:', steps;
  if(inAppBrowser){
    intro = 'داخل مرورگر اینستاگرام نمی‌شه اپ رو نصب کرد. اول سایت رو توی مرورگر اصلی گوشی باز کن:';
    steps = ['منوی <b>⋯</b> بالای صفحه رو بزن', isIOS ? 'گزینه‌ی <b>Open in Safari</b> یا «باز کردن در مرورگر» رو بزن' : 'گزینه‌ی <b>Open in Chrome</b> یا «باز کردن در مرورگر» رو بزن', 'دوباره از منوی سایت، <b>نصب اپ حنا گالری</b> رو بزن'];
  } else if(isIOS){
    steps = [`دکمه‌ی اشتراک‌گذاری ${SHARE_ICO} رو بزن (پایین یا بالای Safari)`, `گزینه‌ی <b>Add to Home Screen</b> ${PLUS_ICO} یا «افزودن به صفحه اصلی» رو انتخاب کن`, 'بالای صفحه <b>Add</b> یا «افزودن» رو بزن'];
  } else {
    steps = ['منوی <b>⋮</b> مرورگر (بالای صفحه) رو بزن', 'گزینه‌ی <b>Install app</b>، «نصب برنامه» یا <b>Add to Home screen</b> رو بزن', '<b>Install</b> یا «افزودن» رو تایید کن'];
  }
  document.getElementById('instIntro').textContent = intro;
  document.getElementById('instSteps').innerHTML = steps.map(x => `<li><span>${x}</span></li>`).join('');
  setInstModal(true);
}
document.getElementById('instOk').addEventListener('click', () => setInstModal(false));
document.getElementById('instOverlay').addEventListener('click', () => setInstModal(false));
document.getElementById('installGo').addEventListener('click', startInstall);
document.getElementById('mnInstall').addEventListener('click', e => { e.preventDefault(); setMenu(false); startInstall(); });
function hideInstallBar(remember){
  document.getElementById('installBar').classList.remove('show');
  if(remember) lsSet('hg-install-later', String(Date.now()));
}
document.getElementById('installX').addEventListener('click', () => hideInstallBar(true));
if(!isStandalone()){
  if(isMobile || installEvent) document.getElementById('mnInstall').hidden = false;
  window.addEventListener('beforeinstallprompt', () => { document.getElementById('mnInstall').hidden = false; });
  // a gentle suggestion on phones, once the visitor has looked around; not again for two weeks after closing it
  const later = Number(lsGet('hg-install-later') || 0);
  if(isMobile && Date.now() - later > 14 * 864e5){
    setTimeout(() => {
      if(document.documentElement.classList.contains('locked') || isStandalone()) return;
      document.getElementById('installBar').classList.add('show');
    }, 25000);
  }
}

// handmade lead time: every customer sees it and taps «متوجه شدم» before the order is placed and the gateway opens
let prepResolve = null, prepTimer = null;
function setPrepModal(open){
  document.getElementById('prepModal').classList.toggle('open', open);
  document.getElementById('prepOverlay').classList.toggle('open', open);
}
function confirmPrepTime(){
  const ok = document.getElementById('prepOk');
  document.getElementById('prepOkLabel').textContent = onlinePaymentOn() ? 'متوجه شدم، برو به پرداخت' : 'متوجه شدم، ثبت سفارش';
  ok.disabled = true;
  clearTimeout(prepTimer); prepTimer = setTimeout(() => { ok.disabled = false; }, 2200);
  setPrepModal(true);
  return new Promise(resolve => { prepResolve = resolve; });
}
function closePrep(result){ setPrepModal(false); if(prepResolve){ prepResolve(result); prepResolve = null; } }
document.getElementById('prepOk').addEventListener('click', () => closePrep(true));
document.getElementById('prepCancel').addEventListener('click', () => closePrep(false));
document.getElementById('prepOverlay').addEventListener('click', () => closePrep(false));

async function ensureNoVpn(){
  if((await checkIranNet(true)) !== false) return true;
  document.getElementById('vpnStatus').textContent = '';
  setVpnModal(true);
  return new Promise(resolve => { vpnResolve = resolve; });
}
document.getElementById('vpnRetry').addEventListener('click', async () => {
  const btn = document.getElementById('vpnRetry'), st = document.getElementById('vpnStatus');
  btn.disabled = true; btn.textContent = 'در حال بررسی اتصال...'; st.textContent = '';
  const iran = await checkIranNet(true);
  btn.disabled = false; btn.textContent = 'خاموش کردم، ادامه بده';
  if(iran === false){
    st.textContent = 'هنوز فیلترشکن روشنه. کامل خاموشش کن، چند ثانیه صبر کن و دوباره بزن.';
    st.classList.remove('shake'); void st.offsetWidth; st.classList.add('shake');
    return;
  }
  setVpnModal(false);
  document.getElementById('vpnBar').hidden = true;
  if(vpnResolve){ vpnResolve(true); vpnResolve = null; }
});
function cancelVpnModal(){ setVpnModal(false); if(vpnResolve){ vpnResolve(false); vpnResolve = null; } }
document.getElementById('vpnCancel').addEventListener('click', cancelVpnModal);
document.getElementById('vpnOverlay').addEventListener('click', cancelVpnModal);
document.getElementById('vpnBarClose').addEventListener('click', () => {
  document.getElementById('vpnBar').hidden = true;
  try{ sessionStorage.setItem('hg-vpn-bar', '1'); }catch(e){}
});
// a gentle heads-up for anyone browsing with a VPN on
setTimeout(async () => {
  let dismissed = false;
  try{ dismissed = sessionStorage.getItem('hg-vpn-bar') === '1'; }catch(e){}
  if(!dismissed && (await checkIranNet(false)) === false) document.getElementById('vpnBar').hidden = false;
}, 1200);

// sends the customer to Zibal; on failure returns a message to show (on success the page navigates away)
async function startPayment(trackingCode){
  if(!(await ensureNoVpn())) return 'برای پرداخت، اول فیلترشکن رو خاموش کن و دوباره «پرداخت» رو بزن.';
  const { data, error } = await db.functions.invoke('payment', {
    body: { action: 'start', trackingCode, returnUrl: location.origin + location.pathname },
  });
  if(!error && data && typeof data.url === 'string' && /^https:\/\/gateway\.zibal\.ir\/start\/\d+$/.test(data.url)){
    location.href = data.url;
    return null;
  }
  let reason = data && data.error;
  if(!reason && error && error.context && typeof error.context.json === 'function'){
    try{ reason = (await error.context.json()).error; }catch(e){}
  }
  if(reason === 'login'){ requireLoginForCheckout(); return 'برای پرداخت اول وارد حسابت شو.'; }
  if(reason === 'vpn'){ netCheck.at = 0; document.getElementById('vpnBar').hidden = false; return 'فیلترشکنت روشنه؛ خاموشش کن و دوباره «پرداخت» رو بزن.'; }
  if(reason === 'already_paid') return 'این سفارش قبلاً پرداخت شده.';
  if(reason === 'not_payable') return 'مهلت پرداخت این سفارش تموم شده؛ لطفاً دوباره سفارش بده.';
  if(reason === 'too_many') return 'چند بار پشت سر هم تلاش کردی؛ چند دقیقه دیگه دوباره امتحان کن.';
  if(reason === 'disabled' || reason === 'not_configured') return 'پرداخت آنلاین الان در دسترس نیست؛ لطفاً با فروشگاه تماس بگیر.';
  return 'اتصال به درگاه پرداخت برقرار نشد. چند لحظه دیگه دوباره امتحان کن.';
}
function showOrderResult({ title, text, code, refText, retryCode, warn }){
  document.getElementById('checkoutSummary').style.display = 'none';
  document.getElementById('checkoutForm').style.display = 'none';
  document.getElementById('orderSuccess').style.display = 'block';
  const titleEl = document.getElementById('orderResultTitle');
  titleEl.textContent = title;
  titleEl.classList.toggle('warn', !!warn);
  document.getElementById('orderResultText').textContent = text || '';
  document.getElementById('orderTrackingCodeText').textContent = code ? 'کد پیگیری سفارش شما: ' + code : '';
  document.getElementById('orderPayRefText').textContent = refText || '';
  const retryBtn = document.getElementById('retryPayBtn');
  retryBtn.style.display = retryCode ? 'block' : 'none';
  retryBtn.dataset.code = retryCode || '';
  retryBtn.disabled = false;
  retryBtn.textContent = 'پرداخت دوباره';
  checkoutPage.classList.add('open');
  checkoutPage.scrollTop = 0;
}
document.getElementById('retryPayBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'در حال انتقال به درگاه...';
  const msg = await startPayment(btn.dataset.code);
  if(msg){ btn.disabled = false; btn.textContent = 'پرداخت دوباره'; showToast(msg); }
});
// pay an order that is still waiting for payment (from My orders)
async function payOrderAgain(trackingCode, btn){
  if(btn){ btn.disabled = true; btn.textContent = 'در حال انتقال...'; }
  const msg = await startPayment(trackingCode);
  if(msg){ if(btn){ btn.disabled = false; btn.textContent = 'پرداخت'; } showToast(msg); }
}
// back from Zibal: ?trackId=...&success=... — the server asks Zibal itself, the URL is never trusted
async function handlePaymentReturn(){
  const m = location.search.match(/[?&]trackId=(\d{1,18})(?:&|$)/);
  if(!m) return;
  history.replaceState(null, '', location.pathname + location.hash);
  showOrderResult({ title: 'در حال بررسی پرداخت...', text: 'چند لحظه صبر کن، داریم نتیجه رو از درگاه می‌گیریم.' });
  document.getElementById('backToShopBtn').style.display = 'none';
  let res = null;
  for(let i = 0; i < 6 && !res; i++){
    const { data, error } = await db.functions.invoke('payment', { body: { action: 'verify', trackId: Number(m[1]) } });
    if(!error && data && data.status && data.status !== 'busy') res = data;
    else await new Promise(r => setTimeout(r, 2500));
  }
  document.getElementById('backToShopBtn').style.display = 'inline-block';
  const code = res && res.trackingCode;
  if(res && res.status === 'paid'){
    cart = []; resetCouponState(); updateCart();
    showOrderResult({
      title: 'پرداخت موفق بود و سفارشت ثبت شد ✓',
      text: 'به‌زودی سفارشت آماده و ارسال می‌شه. وضعیتش رو از «سفارش‌های من» می‌تونی ببینی.',
      code,
      refText: res.refNumber ? 'شماره پیگیری پرداخت: ' + res.refNumber : '',
    });
  } else if(res && res.status === 'failed'){
    showOrderResult({
      warn: true,
      title: 'پرداخت انجام نشد',
      text: 'سفارشت تا حدود یک ساعت برات نگه داشته می‌شه و می‌تونی دوباره پرداختش کنی. اگه مبلغی از حسابت کم شده، بانک حداکثر ظرف ۷۲ ساعت برش می‌گردونه.',
      code,
      retryCode: code,
    });
  } else if(res && res.status === 'cancelled'){
    showOrderResult({
      warn: true,
      title: 'مهلت پرداخت این سفارش تموم شده بود',
      text: 'این سفارش لغو شده و پرداختش تایید نشد؛ اگه مبلغی از حسابت کم شده، حداکثر ظرف ۷۲ ساعت به حسابت برمی‌گرده. لطفاً دوباره سفارش بده.',
      code,
    });
  } else {
    showOrderResult({
      warn: true,
      title: 'نتیجه‌ی پرداخت هنوز مشخص نیست',
      text: 'اگه پرداخت کردی نگران نباش؛ پرداخت‌های موفق خودکار ثبت می‌شن. چند دقیقه دیگه وضعیت سفارش رو از «سفارش‌های من» ببین.',
      code,
    });
  }
}
loadPaymentMode().then(handlePaymentReturn);
try{ document.getElementById('footerYear').textContent = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric' }).format(new Date()).replace(/[^۰-۹0-9]/g, ''); }catch(e){}

document.getElementById('submitOrderBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('formError');
  errorEl.classList.remove('show');

  if(cart.length === 0){
    errorEl.textContent = 'سبد خریدت خالیه.';
    errorEl.classList.add('show');
    return;
  }
  if(!currentUser){ requireLoginForCheckout(); return; }
  if(manualOrderOn()){ submitManualOrder(); return; }
  if(currentProfile && currentProfile.blocked){
    errorEl.textContent = 'ثبت سفارش برای این حساب امکان‌پذیر نیست. لطفاً با فروشگاه تماس بگیر.';
    errorEl.classList.add('show');
    return;
  }
  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const note = document.getElementById('custNote').value.trim();

  document.getElementById('custNameField').classList.toggle('invalid', !name);
  document.getElementById('custPhoneField').classList.toggle('invalid', !phone);
  document.getElementById('custAddressField').classList.toggle('invalid', !address);

  if(!name || !phone || !address){
    errorEl.textContent = 'لطفاً فیلدهای ستاره‌دار (نام، شماره تماس و آدرس) رو پر کن.';
    errorEl.classList.add('show');
    return;
  }
  if(!normalizeIranMobile(phone)){
    document.getElementById('custPhoneField').classList.add('invalid');
    errorEl.textContent = 'شماره موبایل رو درست وارد کن (مثل ۰۹۱۲۳۴۵۶۷۸۹).';
    errorEl.classList.add('show');
    return;
  }

  // stock may have changed since the page loaded: check the live numbers and trim the cart
  const btnCheck = document.getElementById('submitOrderBtn');
  btnCheck.disabled = true;
  const { data: fresh, error: freshErr } = await db.from('products').select('id, stock, variants').in('id', [...new Set(cart.map(i => i.id))]);
  btnCheck.disabled = false;
  if(!freshErr && fresh){
    const byId = {};
    fresh.forEach(f => { byId[f.id] = f; });
    const notes = [];
    const usedStock = {};
    cart.forEach(item => {
      const f = byId[item.id];
      const local = products.find(p => p.id === item.id);
      if(local && f){
        local.stock = f.stock;
        if(local.variants) local.variants.forEach(v => { const q = variantQtyFromText(f.variants, v.name); if(q !== null){ v.qty = q; v.available = q > 0; } });
      }
      let limit = f ? Math.max(0, (Number(f.stock) || 0) - (usedStock[item.id] || 0)) : 0;
      const vq = f && item.variant ? variantQtyFromText(f.variants, item.variant) : null;
      if(vq !== null) limit = Math.min(limit, Math.max(0, vq));
      if(item.qty > limit){
        notes.push(limit > 0 ? `«${item.name}${item.variant ? ' - ' + item.variant : ''}»: فقط ${toFa(limit)} عدد موجوده` : `«${item.name}${item.variant ? ' - ' + item.variant : ''}»: تموم شده`);
        item.qty = limit;
      }
      usedStock[item.id] = (usedStock[item.id] || 0) + item.qty;
    });
    if(notes.length){
      cart = cart.filter(i => i.qty > 0);
      updateCart();
      renderCheckoutSummary();
      errorEl.textContent = 'موجودی بعضی محصولات تغییر کرده و سبدت اصلاح شد: ' + notes.join('، ') + '. اگه موافقی دوباره «ثبت سفارش» رو بزن.';
      errorEl.classList.add('show');
      return;
    }
  }

  // prices, discount and total are decided by the server (place_order); the browser only sends what was picked
  const shownTotal = getCartSubtotal() - getDiscountAmount();
  if(!(await confirmPrepTime())) return;
  // the bank gateway won't open behind a VPN: sort that out before the order is even placed
  if(onlinePaymentOn() && shownTotal > 0 && !(await ensureNoVpn())){
    errorEl.textContent = 'برای پرداخت آنلاین، اول فیلترشکن رو خاموش کن و دوباره «ثبت سفارش» رو بزن.';
    errorEl.classList.add('show');
    return;
  }
  const items = cart.map(i => ({ id:i.id, qty:i.qty, variant:i.variant || null }));
  const couponCode = appliedCoupon ? appliedCoupon.code : null;

  const btn = document.getElementById('submitOrderBtn');
  btn.disabled = true;
  btn.textContent = 'در حال ثبت...';

  const { data: placed, error } = await db.rpc('place_order', {
    p_items: items, p_name: name, p_phone: phone, p_address: address, p_note: note || null, p_coupon: couponCode,
  });

  if(!error && currentUser){
    await db.from('profiles').upsert({
      id: currentUser.id,
      full_name: name,
      phone: phone,
      address: address,
      updated_at: new Date().toISOString(),
    });
    currentProfile = { ...currentProfile, full_name: name, phone, address };
  }

  btn.disabled = false;
  btn.textContent = submitBtnLabel();

  if(error && /HG_LOGIN|permission denied/.test(error.message || '')){ requireLoginForCheckout(); return; }
  if(error || !placed){
    console.error('خطا در ثبت سفارش:', error);
    errorEl.textContent = orderErrorMessage(error);
    errorEl.classList.add('show');
    if(error && /HG_COUPON/.test(error.message || '')){ resetCouponState(); renderCheckoutSummary(); }
    return;
  }
  const trackingCode = placed.tracking_code;
  const totalNote = Number(placed.total) !== shownTotal ? ` مبلغ نهایی: ${toFa(Number(placed.total))} تومان.` : '';
  ['custName', 'custPhone', 'custAddress', 'custNote'].forEach(id => { document.getElementById(id).value = ''; });

  if(placed.needs_payment){
    // the order holds its items while the customer pays; SMS goes out once the payment is confirmed
    cart = [];
    resetCouponState();
    updateCart();
    fetchProducts();
    showOrderResult({ title: 'در حال انتقال به درگاه پرداخت...', text: 'سفارشت ثبت شد و موجودی‌اش برات نگه داشته شده.' + totalNote, code: trackingCode });
    const msg = await startPayment(trackingCode);
    if(msg){
      showOrderResult({
        warn: true,
        title: 'سفارشت ثبت شد ولی هنوز پرداخت نشده',
        text: msg + ' سفارش تا ۳۰ دقیقه برات نگه داشته می‌شه؛ از «سفارش‌های من» هم می‌تونی پرداختش کنی.',
        code: trackingCode,
        retryCode: trackingCode,
      });
    }
    return;
  }

  // اطلاع‌رسانی پیامکی به مالک فروشگاه و تاییدیه به مشتری؛ سرور اطلاعات رو خودش از روی کد پیگیری می‌خونه
  db.functions.invoke('notify-order', { body: { trackingCode } }).catch(() => {});

  cart = [];
  resetCouponState();
  updateCart();
  showOrderResult({
    title: 'سفارش شما ثبت شد ✓',
    text: (placed.payment_status === 'free' ? 'به‌زودی سفارشت آماده و ارسال می‌شه.' : 'به‌زودی برای هماهنگی پرداخت و ارسال با شما تماس می‌گیریم.') + totalNote,
    code: trackingCode,
  });
  fetchProducts(); // stock changed
});

['custName', 'custPhone', 'custAddress'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    document.getElementById(id + 'Field').classList.remove('invalid');
  });
});

/* ================= حساب کاربری (ورود / ثبت‌نام) ================= */

let wishlistIds = new Set();
async function loadWishlist(){
  wishlistIds = new Set();
  if(!currentUser) return;
  const { data } = await db.from('wishlists').select('product_id').eq('user_id', currentUser.id);
  (data || []).forEach(r => wishlistIds.add(r.product_id));
}
function refreshAllProductGrids(){
  if(typeof wishlistPage !== 'undefined' && wishlistPage.classList.contains('open')) renderWishlistPage();
  renderNewest();
  if(!isCategoryFocused()) renderSaleProducts();
  if(currentCat) renderProducts(currentCat);
}
async function toggleWishlist(id){
  if(!currentUser){ openAuthModal(); return; }
  const has = wishlistIds.has(id);
  if(has){
    wishlistIds.delete(id);
    refreshAllProductGrids();
    await db.from('wishlists').delete().eq('user_id', currentUser.id).eq('product_id', id);
  } else {
    wishlistIds.add(id);
    wishlistOrder = [id, ...wishlistOrder.filter(x => x !== id)];
    wishBurstId = id;
    refreshAllProductGrids();
    wishBurstId = null;
    const { error } = await db.from('wishlists').insert({ user_id: currentUser.id, product_id: id });
    if(error){ wishlistIds.delete(id); refreshAllProductGrids(); }
  }
}
let authOtpPurpose = 'login'; // 'login' یا 'forgot' — تعیین می‌کنه بعد از تایید کد چیکار کنیم

const authOverlay = document.getElementById('authOverlay');
const authModal = document.getElementById('authModal');
const accountPanel = document.getElementById('accountPanel');
const loginLinkBtn = document.getElementById('loginLinkBtn');

function toE164(local){
  // ورودی: 09xxxxxxxxx یا 9xxxxxxxxx یا 989xxxxxxxxx → خروجی: +989xxxxxxxxx
  let digits = local.replace(/\D/g, '');
  if(digits.startsWith('0')) digits = digits.slice(1);
  if(digits.startsWith('98')) digits = digits.slice(2);
  return '+98' + digits;
}

function showAuthStep(stepId){
  ['authStepPhonePass','authStepPhone','authStepOtp','authStepSetup'].forEach(id => {
    const el = document.getElementById(id);
    el.style.display = (id === stepId) ? 'block' : 'none';
    if(id === stepId){ el.classList.remove('auth-step-in'); void el.offsetWidth; el.classList.add('auth-step-in'); }
  });
  const seg = document.getElementById('authSeg');
  if(seg){
    seg.hidden = stepId === 'authStepSetup';
    const otp = stepId !== 'authStepPhonePass';
    seg.classList.toggle('otp', otp);
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.go === 'otp') === otp));
  }
}
document.querySelectorAll('#authSeg button').forEach(b => b.addEventListener('click', () => {
  if(b.classList.contains('on')) return;
  document.getElementById(b.dataset.go === 'otp' ? 'authUseOtpLink' : 'authBackToPassLink').click();
}));
// show / hide toggle on every password field of the login sheet
document.querySelectorAll('#authModal input[type="password"]').forEach(inp => {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'pw-eye'; btn.setAttribute('aria-label', 'نمایش رمز');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="slash" d="M4 4l16 16"/></svg>';
  btn.addEventListener('click', () => {
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.classList.toggle('shown', show);
    btn.setAttribute('aria-label', show ? 'پنهان کردن رمز' : 'نمایش رمز');
  });
  inp.parentNode.appendChild(btn);
});

function openAuthModal(){
  authModal.classList.add('open');
  authOverlay.classList.add('open');
  showAuthStep('authStepPhonePass');
  document.getElementById('authPhonePass').value = '';
  document.getElementById('authPasswordLogin').value = '';
  document.getElementById('authPhone').value = '';
  if(typeof otpReset === 'function') otpReset(); else document.getElementById('authOtp').value = '';
  document.getElementById('authPassError').classList.remove('show');
  document.getElementById('authError').classList.remove('show');
  document.getElementById('authOtpError').classList.remove('show');
  document.getElementById('authSetupError').classList.remove('show');
}
// while a new account is being set up (name + password) the sheet can't simply be dismissed:
// closing it cancels the sign-up and signs the half-made session out
let authSetupLocked = false;
function lockAuthSetup(on){ authSetupLocked = on; authModal.classList.toggle('locked', on); }
async function closeAuthModal(){
  if(authSetupLocked){
    lockAuthSetup(false);
    authModal.classList.remove('open'); authOverlay.classList.remove('open');
    pendingCheckout = false;
    document.getElementById('authCheckoutNote').style.display = 'none';
    await db.auth.signOut();
    showToast('ثبت‌نام کامل نشد. هر وقت خواستی دوباره شماره‌ت رو وارد کن.');
    return;
  }
  authModal.classList.remove('open'); authOverlay.classList.remove('open'); resumeCheckoutIfPending();
}
function showProfileSetup(forgot){
  const setupIntro = document.getElementById('authSetupIntro');
  const nameField = document.getElementById('authSetupNameField');
  const addressField = document.getElementById('authSetupAddressField');
  if(forgot){
    setupIntro.textContent = 'یه رمز جدید برای حسابت انتخاب کن.';
    nameField.style.display = 'none';
    addressField.style.display = 'none';
  } else {
    setupIntro.textContent = 'برای تکمیل ثبت‌نام، این اطلاعات رو وارد کن. تا وقتی کامل نشه، ورود انجام نمی‌شه.';
    nameField.style.display = 'block';
    addressField.style.display = 'block';
    document.getElementById('authSetupName').value = currentProfile ? (currentProfile.full_name || '') : '';
    document.getElementById('authSetupAddress').value = currentProfile ? (currentProfile.address || '') : '';
  }
  lockAuthSetup(true);
  showAuthStep('authStepSetup');
  authModal.classList.add('open'); authOverlay.classList.add('open');
}
// a phone account that never finished sign-up (no name yet) is sent back to the setup step
function enforceProfileSetup(){
  if(!currentUser || !currentUser.phone || (currentProfile && currentProfile.full_name)) return;
  if(authSetupLocked) return;
  // the code was just verified: let the success animation play, afterOtpVerified() opens the setup step itself
  try{ if(otpDone || otpBusy) return; }catch(e){}
  authOtpPurpose = 'login';
  showProfileSetup(false);
}
function fmtPhoneFa(p){
  const d = String(p || '').replace(/\D/g, '').replace(/^98/, '0');
  return d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : d;
}
async function openAccountPanel(){
  accountPanel.classList.add('open'); authOverlay.classList.add('open');
  animateNumber(document.getElementById('accWishCount'), wishlistIds.size, '');
  if(!currentUser) return;
  const { data } = await db.from('orders').select('id, cancel_reason').eq('user_id', currentUser.id);
  const n = (data || []).filter(o => o.cancel_reason !== 'replaced').length;
  animateNumber(document.getElementById('accOrdersCount'), n, '');
}
function closeAccountPanel(){ accountPanel.classList.remove('open'); authOverlay.classList.remove('open'); }

authOverlay.addEventListener('click', () => { closeAuthModal(); closeAccountPanel(); });
document.getElementById('authClose').addEventListener('click', closeAuthModal);
document.getElementById('accountClose').addEventListener('click', closeAccountPanel);

loginLinkBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if(currentUser){ openAccountPanel(); } else { openAuthModal(); }
});

document.getElementById('menuAccountLink').addEventListener('click', (e) => {
  e.preventDefault();
  if(currentUser){ openAccountPanel(); } else { openAuthModal(); }
});

let authPhoneE164 = '';

// ---- مرحله‌ی ۱: ورود مستقیم با شماره + رمز ----
document.getElementById('authLoginPassBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('authPassError');
  errorEl.classList.remove('show');
  const phoneRaw = document.getElementById('authPhonePass').value.trim();
  const password = document.getElementById('authPasswordLogin').value;
  const digits = phoneRaw.replace(/\D/g, '');
  if(digits.length < 10 || !password){
    errorEl.textContent = 'شماره موبایل و رمز عبور رو کامل وارد کن.';
    errorEl.classList.add('show');
    return;
  }
  const btn = document.getElementById('authLoginPassBtn');
  btn.disabled = true;
  btn.querySelector('.btn-label').textContent = 'در حال ورود...';
  const { error } = await db.auth.signInWithPassword({ phone: toE164(phoneRaw), password });
  btn.disabled = false;
  btn.querySelector('.btn-label').textContent = 'ورود';
  if(error){
    errorEl.textContent = 'شماره یا رمز عبور اشتباهه.';
    errorEl.classList.add('show');
    return;
  }
  closeAuthModal();
});

document.getElementById('authUseOtpLink').addEventListener('click', (e) => {
  e.preventDefault();
  authOtpPurpose = 'login';
  document.getElementById('authPhone').value = document.getElementById('authPhonePass').value;
  showAuthStep('authStepPhone');
});

document.getElementById('authForgotLink').addEventListener('click', (e) => {
  e.preventDefault();
  authOtpPurpose = 'forgot';
  document.getElementById('authPhone').value = document.getElementById('authPhonePass').value;
  showAuthStep('authStepPhone');
});

document.getElementById('authBackToPassLink').addEventListener('click', (e) => {
  e.preventDefault();
  showAuthStep('authStepPhonePass');
});

// ---- مرحله‌ی ۲: ارسال کد پیامکی ----
document.getElementById('authSendCodeBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('authError');
  errorEl.classList.remove('show');
  const phoneRaw = document.getElementById('authPhone').value.trim();
  const digits = phoneRaw.replace(/\D/g, '');
  if(digits.length < 10){
    errorEl.textContent = 'شماره موبایل معتبر وارد کن.';
    errorEl.classList.add('show');
    return;
  }
  authPhoneE164 = toE164(phoneRaw);
  const btn = document.getElementById('authSendCodeBtn');
  btn.disabled = true;
  btn.querySelector('.btn-label').textContent = 'در حال ارسال...';
  const { error } = await db.auth.signInWithOtp({ phone: authPhoneE164 });
  btn.disabled = false;
  btn.querySelector('.btn-label').textContent = 'دریافت کد تایید';
  if(error){
    console.error('خطا در ارسال کد:', error);
    errorEl.textContent = 'مشکلی پیش اومد، دوباره امتحان کن.';
    errorEl.classList.add('show');
    return;
  }
  document.getElementById('authPhoneDisplay').textContent = phoneRaw;
  otpReset();
  showAuthStep('authStepOtp');
  otpStartResendTimer();
  setTimeout(() => document.getElementById('authOtp').focus(), 350);
});

document.getElementById('authChangePhoneLink').addEventListener('click', (e) => {
  e.preventDefault();
  showAuthStep('authStepPhone');
});

// ---- مرحله‌ی ۳: تایید کد ----
// six tiles over one invisible input (so paste and the phone's SMS code suggestion still work);
// a full code is checked at once: the tiles orbit while it's checked, then fold into a check or shake back
const OTP_LEN = 6;
const otpBox = document.getElementById('otpBox'), otpInput = document.getElementById('authOtp'), otpCellsEl = document.getElementById('otpCells');
const otpSubHtml = document.getElementById('otpSub').innerHTML;
let otpBusy = false, otpDone = false, otpResendT = null;
otpCellsEl.innerHTML = Array.from({ length: OTP_LEN }, (_, i) => {
  const step = 52, a = (-90 + i * 360 / OTP_LEN) * Math.PI / 180, r = 62;
  return `<span class="otp-cell" style="--i:${i};--rx:${((i - (OTP_LEN - 1) / 2) * step).toFixed(1)}px;--ox:${(Math.cos(a) * r).toFixed(1)}px;--oy:${(Math.sin(a) * r).toFixed(1)}px;--rot:${[-12, 9, -6, 14, -9, 7][i % 6]}deg"></span>`;
}).join('');
const otpCells = [...otpCellsEl.children];
function otpRender(popAt){
  const v = otpInput.value, focused = document.activeElement === otpInput;
  otpCells.forEach((c, i) => {
    c.innerHTML = v[i] ? `<b>${toFaDigits(v[i])}</b>` : '';
    c.classList.toggle('full', !!v[i]);
    c.classList.toggle('on', focused && !otpBusy && !otpDone && i === Math.min(v.length, OTP_LEN - 1));
    c.classList.toggle('pop', i === popAt);
  });
}
function otpReset(){
  otpBusy = false; otpDone = false;
  otpInput.value = '';
  otpBox.classList.remove('checking', 'bad', 'ok');
  document.getElementById('authStepOtp').classList.remove('verified');
  document.getElementById('otpTitle').textContent = 'شماره‌ت رو تایید کن';
  document.getElementById('otpSub').innerHTML = otpSubHtml.replace('<span id="authPhoneDisplay" dir="ltr"></span>', document.getElementById('authPhoneDisplay').outerHTML);
  document.getElementById('authVerifyBtn').hidden = true;
  document.getElementById('authOtpError').classList.remove('show');
  otpRender();
}
function otpStartResendTimer(){
  const btn = document.getElementById('otpResend');
  let left = 60;
  clearInterval(otpResendT);
  btn.disabled = true;
  const tick = () => {
    btn.textContent = left > 0 ? `ارسال مجدد (${toFa(left)} ثانیه)` : 'ارسال مجدد';
    btn.disabled = left > 0;
    if(left-- <= 0) clearInterval(otpResendT);
  };
  tick(); otpResendT = setInterval(tick, 1000);
}
document.getElementById('otpResend').addEventListener('click', async () => {
  const btn = document.getElementById('otpResend');
  btn.disabled = true; btn.textContent = 'در حال ارسال...';
  const { error } = await db.auth.signInWithOtp({ phone: authPhoneE164 });
  if(error){ btn.disabled = false; btn.textContent = 'ارسال مجدد'; showToast('ارسال نشد؛ چند لحظه بعد دوباره امتحان کن'); return; }
  showToast('کد تازه پیامک شد');
  otpReset(); otpStartResendTimer(); otpInput.focus();
});
otpInput.addEventListener('input', () => {
  if(otpBusy || otpDone) return;
  const before = otpCells.filter(c => c.classList.contains('full')).length;
  otpInput.value = latinDigits(otpInput.value).replace(/\D/g, '').slice(0, OTP_LEN);
  otpBox.classList.remove('bad');
  document.getElementById('authOtpError').classList.remove('show');
  otpRender(otpInput.value.length > before ? otpInput.value.length - 1 : -1);
  if(otpInput.value.length === OTP_LEN) verifyAuthCode();
});
otpInput.addEventListener('focus', () => otpRender());
otpInput.addEventListener('blur', () => otpRender());
const otpWait = ms => new Promise(r => setTimeout(r, ms));
async function verifyAuthCode(){
  if(otpBusy || otpDone) return;
  const code = otpInput.value;
  const errorEl = document.getElementById('authOtpError');
  otpBusy = true;
  otpInput.blur();
  otpBox.classList.remove('bad');
  otpBox.classList.add('checking');
  otpRender();
  const [{ error }] = await Promise.all([db.auth.verifyOtp({ phone: authPhoneE164, token: code, type: 'sms' }), otpWait(1300)]);
  otpBox.classList.remove('checking');
  if(error){
    otpBusy = false;
    otpBox.classList.add('bad');
    errorEl.textContent = 'کد درست نیست یا منقضی شده؛ دوباره وارد کن.';
    errorEl.classList.add('show');
    setTimeout(() => { otpInput.value = ''; otpRender(); otpInput.focus(); }, 650);
    return;
  }
  otpBusy = false; otpDone = true;
  otpBox.classList.add('ok');
  document.getElementById('authStepOtp').classList.add('verified');
  document.getElementById('otpTitle').textContent = 'با موفقیت تایید شد';
  document.getElementById('otpSub').textContent = 'شماره‌ی موبایلت تایید شد.';
  const go = document.getElementById('authVerifyBtn');
  go.hidden = false;
  clearInterval(otpResendT);
  setTimeout(afterOtpVerified, 1700);
}
let otpProceeded = false;
async function afterOtpVerified(){
  if(otpProceeded || !otpDone) return;
  otpProceeded = true;
  otpDone = false;
  setTimeout(() => { otpProceeded = false; }, 3000);
  // بعد از تایید کد، پروفایل رو چک می‌کنیم ببینیم قبلاً تکمیل شده یا نه
  await loadProfile();
  if(authOtpPurpose === 'forgot'){
    showProfileSetup(true);
  } else if(!currentProfile || !currentProfile.full_name){
    showProfileSetup(false);
  } else {
    closeAuthModal();
  }
}
document.getElementById('authVerifyBtn').addEventListener('click', afterOtpVerified);

// ---- مرحله‌ی ۴: تکمیل حساب / تنظیم رمز جدید ----
document.getElementById('authSetupSubmitBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('authSetupError');
  errorEl.classList.remove('show');
  const isForgot = authOtpPurpose === 'forgot';
  const name = document.getElementById('authSetupName').value.trim();
  const address = document.getElementById('authSetupAddress').value.trim();
  const password = document.getElementById('authSetupPassword').value;
  const password2 = document.getElementById('authSetupPassword2').value;

  if(!isForgot && !name){
    errorEl.textContent = 'نام و نام خانوادگی رو وارد کن.';
    errorEl.classList.add('show');
    return;
  }
  if(!password || password.length < 6){
    errorEl.textContent = 'رمز عبور باید حداقل ۶ کاراکتر باشه.';
    errorEl.classList.add('show');
    return;
  }
  if(password !== password2){
    errorEl.textContent = 'رمز عبور و تکرارش یکی نیستن.';
    errorEl.classList.add('show');
    return;
  }

  const btn = document.getElementById('authSetupSubmitBtn');
  btn.disabled = true;
  btn.querySelector('.btn-label').textContent = 'در حال ذخیره...';

  const { error: passError } = await db.auth.updateUser({ password });

  if(!passError && !isForgot){
    await db.from('profiles').upsert({
      id: currentUser.id,
      full_name: name,
      phone: currentUser.phone,
      address: address,
      updated_at: new Date().toISOString(),
    });
    currentProfile = { full_name: name, phone: currentUser.phone, address };
    refreshAuthUI();
  }

  btn.disabled = false;
  btn.querySelector('.btn-label').textContent = 'ذخیره و ورود';

  if(passError){
    errorEl.textContent = 'مشکلی پیش اومد، دوباره امتحان کن.';
    errorEl.classList.add('show');
    return;
  }
  lockAuthSetup(false);
  closeAuthModal();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await db.auth.signOut();
  closeAccountPanel();
});

let myOrdersCache = [];

// order progress for the customer: 1 placed · 2 confirmed · 3 shipped · 4 delivered (0 = waiting for payment, -1 = cancelled)
function orderStep(o){
  if(o.status === 'لغو شده') return -1;
  if(o.status === PAY_PENDING) return 0;
  return { 'پرداخت شده': 1, 'جدید': 1, 'تایید شده': 2, 'ارسال شده': 3, 'تحویل داده شده': 4 }[o.status] || 1;
}
const ORDER_STEPS = [
  ['ثبت سفارش', '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>'],
  ['تایید و آماده‌سازی', '<path d="M12 2.5c.8 5.4 3.4 8 8.8 8.8-5.4.8-8 3.4-8.8 8.8-.8-5.4-3.4-8-8.8-8.8 5.4-.8 8-3.4 8.8-8.8z"/>'],
  ['ارسال شد', '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17.5" cy="17.5" r="1.6"/>'],
  ['تحویل', '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>']
];
function orderTrackHtml(o, big){
  const st = orderStep(o);
  if(st < 1) return '';
  return `<div class="ot${big ? ' big' : ''}" style="--p:${(st - 1) / 3}">
    <div class="ot-line"><i></i></div>
    ${ORDER_STEPS.map(([label, ico], k) => `<div class="ot-step${k + 1 <= st ? ' done' : ''}${k + 1 === st ? ' now' : ''}"><span class="ot-dot">${big ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ico}</svg>` : ''}</span>${big ? `<small>${label}</small>` : ''}</div>`).join('')}
  </div>`;
}
function orderDateFa(iso){ return new Date(iso).toLocaleDateString('fa-IR', { day: 'numeric', month: 'long', year: 'numeric' }); }
let myOrdersImgMap = {};
function orderThumb(i){
  const prod = myOrdersImgMap[i.id];
  const src = prod && prod.image_url ? thumbUrl(prod.image_url.split(/[,،]/).map(s => s.trim()).filter(Boolean)[0]) : null;
  return src ? `<img src="${src}" alt="" loading="lazy" onerror="thumbFallback(this)">` : icons.necklace;
}
async function loadOrderImages(orders){
  const ids = [...new Set(orders.flatMap(o => (o.items || []).map(i => i.id)))].filter(id => !myOrdersImgMap[id]);
  if(!ids.length) return;
  const { data } = await db.from('products').select('id, image_url').in('id', ids);
  (data || []).forEach(p => { myOrdersImgMap[p.id] = p; });
}
function myOrdersEmptyHtml(){
  return `<div class="op-empty">
    <svg viewBox="0 0 64 64" aria-hidden="true"><path class="l" d="M10 22l22-12 22 12v22L32 56 10 44z"/><path class="l" d="M10 22l22 12 22-12M32 34v22"/><path class="g" d="M32 13c2.4 3.1 4 5.2 4 7.2 0 2.2-1.8 3.8-4 3.8s-4-1.6-4-3.8c0-2 1.6-4.1 4-7.2z"/></svg>
    <b>هنوز سفارشی ثبت نکردی</b>
    <span>اولین سفارشت که ثبت بشه، این‌جا می‌تونی مرحله به مرحله دنبالش کنی.</span>
    <button type="button" onclick="document.getElementById('myOrdersPage').classList.remove('open'); document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });">مشاهده‌ی محصولات</button>
  </div>`;
}
document.getElementById('viewOrdersBtn').addEventListener('click', async () => {
  closeAccountPanel();
  document.getElementById('myOrdersPage').classList.add('open');
  const listEl = document.getElementById('myOrdersPageBody');
  listEl.innerHTML = '<div class="op-skel"></div><div class="op-skel"></div><div class="op-skel"></div>';
  const { data, error } = await db.from('orders').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  // checkouts the customer abandoned and replaced with a newer one are just noise here
  myOrdersCache = (error || !data) ? [] : data.filter(o => o.cancel_reason !== 'replaced');
  if(myOrdersCache.length === 0){ listEl.innerHTML = myOrdersEmptyHtml(); return; }
  await loadOrderImages(myOrdersCache);
  listEl.innerHTML = `<p class="op-count">${toFa(myOrdersCache.length)} سفارش</p>` + myOrdersCache.map((o, k) => {
    const items = o.items || [];
    const qty = items.reduce((a, i) => a + (Number(i.qty) || 0), 0);
    const tone = STATUS_TONE[o.status] || 'ok';
    const names = items.map(i => escapeHtml(i.name)).join('، ');
    return `<div class="oc" style="--k:${k}" onclick="openOrderDetail(${o.id})" role="button" tabindex="0">
      <div class="oc-top">
        <span class="oc-status tone-${tone}">${escapeHtml(customerStatusText(o))}</span>${payBadgeHtml(o)}
        <span class="oc-date">${orderDateFa(o.created_at)}</span>
      </div>
      <div class="oc-mid">
        <div class="oc-thumbs">${items.slice(0, 3).map(i => `<span>${orderThumb(i)}</span>`).join('')}${items.length > 3 ? `<span class="more">+${toFa(items.length - 3)}</span>` : ''}</div>
        <div class="oc-names"><b>${names}</b><small>${toFa(qty)} عدد${o.tracking_code ? ` · کد <span class="op-code">${escapeHtml(o.tracking_code)}</span>` : ''}</small></div>
      </div>
      ${orderTrackHtml(o, false)}
      <div class="oc-foot">
        <span class="oc-total">${toFa(o.total)} <small>تومان</small></span>
        ${o.status === PAY_PENDING ? `<button type="button" class="oi-pay-btn" onclick="event.stopPropagation(); payOrderAgain('${escapeHtml(o.tracking_code)}', this)">پرداخت</button>` : `<span class="oc-more">جزئیات <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></span>`}
      </div>
    </div>`;
  }).join('');
});
function customerStatusText(o){
  if(o.status === 'لغو شده' && o.cancel_reason === 'expired') return 'لغو شده (پرداخت نشد)';
  return o.status || 'جدید';
}
function payBadgeHtml(o, withRef){
  const test = o.pay_sandbox ? ' test' : '';
  if(o.payment_status === 'paid'){
    if(!withRef && o.status === 'پرداخت شده' && !o.pay_sandbox) return ''; // the status already says it
    return `<span class="pay-badge paid${test}">پرداخت آنلاین${o.pay_sandbox ? ' (آزمایشی)' : ''}${withRef && o.pay_ref_number ? ` · پیگیری: <span style="direction:ltr;unicode-bidi:isolate;">${escapeHtml(o.pay_ref_number)}</span>` : ''}</span>`;
  }
  if(o.status === PAY_PENDING) return `<span class="pay-badge wait${test}">${o.payment_status === 'failed' ? 'پرداخت ناموفق' : 'پرداخت نشده'}</span>`;
  return '';
}
document.getElementById('myOrdersBackBtn').addEventListener('click', () => {
  document.getElementById('myOrdersPage').classList.remove('open');
});

async function openOrderDetail(orderId){
  const order = myOrdersCache.find(o => o.id === orderId);
  if(!order) return;
  const bodyEl = document.getElementById('orderDetailBody');
  bodyEl.innerHTML = '<div class="op-skel tall"></div><div class="op-skel"></div>';
  document.getElementById('orderDetailTitle').textContent = order.tracking_code ? 'سفارش ' + order.tracking_code : 'جزئیات سفارش';
  document.getElementById('orderDetailPage').classList.add('open');
  await loadOrderImages([order]);

  const st = orderStep(order);
  const items = order.items || [];
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0);
  const tone = STATUS_TONE[order.status] || 'ok';
  const itemsHtml = items.map(i => `
      <div class="od-item">
        <span class="od-img">${orderThumb(i)}</span>
        <div class="od-info"><b>${escapeHtml(i.name)}</b>${i.variant ? `<span class="di-variant">${escapeHtml(i.variant)}</span>` : ''}<small>${toFa(i.qty)} × ${toFa(i.price)} تومان</small></div>
        <span class="od-line">${toFa(i.price * i.qty)} <small>تومان</small></span>
      </div>`).join('');
  const statusNote = st === -1 ? (order.cancel_reason === 'expired' ? 'این سفارش چون پرداخت نشد، خودکار لغو شد.' : 'این سفارش لغو شده.')
    : st === 0 ? 'سفارشت ثبت شده و منتظر پرداخته. اگه تا یک ساعت پرداخت نشه، خودکار لغو می‌شه.'
    : st === 1 ? 'سفارشت ثبت شد و به‌زودی تایید و آماده‌ی ارسال می‌شه.'
    : st === 2 ? 'سفارشت تایید شد و در حال آماده‌سازیه.'
    : st === 3 ? 'سفارشت ارسال شد؛ کد رهگیری مرسوله پایین‌تر هست.'
    : 'سفارشت تحویل داده شد. امیدواریم دوستش داشته باشی.';

  bodyEl.innerHTML = `
    <section class="od-hero tone-${tone}">
      <div class="od-hero-top"><span class="oc-status tone-${tone}">${escapeHtml(customerStatusText(order))}</span>${payBadgeHtml(order, true)}<span class="oc-date">${orderDateFa(order.created_at)}</span></div>
      <p class="od-note">${statusNote}</p>
      ${orderTrackHtml(order, true)}
      ${st === 0 ? `<button type="button" class="drawer-cta od-pay" onclick="payOrderAgain('${escapeHtml(order.tracking_code)}', this)">پرداخت ${toFa(order.total)} تومان</button>` : ''}
    </section>
    <section class="od-card od-code">
      <div><small>کد پیگیری سفارش</small><b class="op-code">${order.tracking_code ? escapeHtml(order.tracking_code) : '—'}</b></div>
      ${order.tracking_code ? `<button type="button" class="od-copy" onclick="copyText(${escapeHtml(JSON.stringify(String(order.tracking_code)))}, this)">کپی</button>` : ''}
    </section>
    ${order.post_tracking ? `<section class="od-card od-ship">
      <div class="od-ship-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ORDER_STEPS[2][1]}</svg></div>
      <div><small>ارسال با ${escapeHtml(order.post_carrier || 'پست')} · کد رهگیری مرسوله</small><b class="op-code">${escapeHtml(order.post_tracking)}</b>
      ${(order.post_carrier || 'پست') === 'پست' ? `<a href="https://tracking.post.ir/" target="_blank" rel="noopener">پیگیری در سایت پست ←</a>` : ''}</div>
      <button type="button" class="od-copy" onclick="copyText(${escapeHtml(JSON.stringify(String(order.post_tracking)))}, this)">کپی</button>
    </section>` : ''}
    <section class="od-card">
      <h4>محصولات</h4>
      ${itemsHtml}
      <div class="od-sum">
        <div><span>جمع محصولات</span><span>${toFa(subtotal)} تومان</span></div>
        ${order.coupon_code ? `<div class="off"><span>کد تخفیف ${escapeHtml(order.coupon_code)}</span><span>−${toFa(order.discount_amount || 0)} تومان</span></div>` : ''}
        <div><span>هزینه‌ی ارسال</span><span>پس‌کرایه، درب منزل</span></div>
        <div class="tot"><span>مبلغ پرداختی</span><span>${toFa(order.total)} تومان</span></div>
      </div>
    </section>
    ${order.customer_address ? `<section class="od-card od-addr">
      <div class="od-ship-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg></div>
      <div><small>آدرس تحویل</small><p>${escapeHtml(order.customer_address)}</p>${order.customer_name || order.customer_phone ? `<small>${escapeHtml(order.customer_name || '')}${order.customer_phone ? ` · <span class="op-code">${escapeHtml(order.customer_phone)}</span>` : ''}</small>` : ''}</div>
    </section>` : ''}
  `;
}
async function copyText(text, btn){
  try{ await navigator.clipboard.writeText(text); if(btn){ btn.textContent = 'کپی شد ✓'; btn.classList.add('ok'); } }
  catch(e){ showToast('کد: ' + text); }
}
function closeOrderDetail(){ document.getElementById('orderDetailPage').classList.remove('open'); }
document.getElementById('orderDetailBackBtn').addEventListener('click', closeOrderDetail);

/* ================= صفحه‌ی جداگانه‌ی علاقه‌مندی‌ها ================= */
const wishlistPage = document.getElementById('wishlistPage');
let wishlistOrder = []; // product ids, newest favourite first
function renderWishlistPage(){
  const gridEl = document.getElementById('wishlistGrid');
  const items = wishlistOrder.filter(id => wishlistIds.has(id)).map(id => products.find(p => p.id === id)).filter(Boolean);
  if(items.length === 0){
    gridEl.innerHTML = `<div class="wishlist-empty"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-9.5-9C1 7.5 2.8 4 6.2 4c2 0 3.4 1.1 4.3 2.4C11.4 5.1 12.8 4 14.8 4 18.2 4 20 7.5 18.5 11c-2.5 4.6-9.5 9-9.5 9z"/></svg><br>هنوز محصولی به علاقه‌مندی‌ها اضافه نکردی.<br>روی قلبِ هر محصول بزن تا این‌جا ذخیره بشه.</div>`;
    return;
  }
  gridEl.innerHTML = items.map(productCardHtml).join('');
  observeCardPreloads();
}
async function openWishlistPage(){
  if(!currentUser){ openAuthModal(); return; }
  closeAccountPanel();
  wishlistPage.classList.add('open');
  wishlistPage.scrollTop = 0;
  document.getElementById('wishlistGrid').innerHTML = Array(2).fill(skeletonCardHtml()).join('');
  const { data } = await db.from('wishlists').select('product_id').eq('user_id', currentUser.id).order('created_at', { ascending: false });
  if(data){
    wishlistOrder = data.map(r => r.product_id);
    wishlistIds = new Set(wishlistOrder);
  }
  renderWishlistPage();
}
function closeWishlistPage(){ wishlistPage.classList.remove('open'); }
document.getElementById('viewWishlistBtn').addEventListener('click', openWishlistPage);
document.getElementById('wishlistBackBtn').addEventListener('click', closeWishlistPage);

async function loadProfile(){
  if(!currentUser) { currentProfile = null; return; }
  const { data } = await db.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  currentProfile = data || null;
}

let isAdmin = false;
async function checkAdmin(){
  if(!currentUser || !currentUser.phone){ isAdmin = false; stopHeartbeat(); stopOrdersRealtime(); return; }
  const { data } = await db.from('admins').select('phone').eq('phone', currentUser.phone).maybeSingle();
  isAdmin = !!data;
  if(isAdmin){ startHeartbeat(); startOrdersRealtime(); } else { stopHeartbeat(); stopOrdersRealtime(); }
}

function refreshAuthUI(){
  updateCart();
  if(currentUser){
    const phone = currentUser.phone || '';
    const displayName = (currentProfile && currentProfile.full_name) ? currentProfile.full_name : phone;
    loginLinkBtn.textContent = displayName;
    document.getElementById('accountPhoneText').textContent = fmtPhoneFa(phone);
    const name = (currentProfile && currentProfile.full_name) || 'کاربر حنا گالری';
    document.getElementById('accName').textContent = name;
    document.getElementById('accInitial').textContent = name.trim().charAt(0);
  } else {
    loginLinkBtn.textContent = 'ورود و ثبت‌نام';
  }
  document.getElementById('adminPanelBtn').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('accRole').hidden = !isAdmin;
  updatePayLabels();
}

db.auth.getSession().then(({ data }) => {
  currentUser = data.session ? data.session.user : null;
  refreshAuthUI();
  if(currentUser) loadProfile().then(() => checkAdmin()).then(refreshAuthUI);
  loadWishlist().then(refreshAllProductGrids);
});

db.auth.onAuthStateChange((_event, session) => {
  currentUser = session ? session.user : null;
  refreshAuthUI();
  if(currentUser) loadProfile().then(() => checkAdmin()).then(() => { refreshAuthUI(); enforceProfileSetup(); }); else { currentProfile = null; isAdmin = false; }
  loadWishlist().then(refreshAllProductGrids);
});

// شمارش بازدید سایت (هر بار که صفحه باز بشه، یه واحد اضافه می‌شه)
db.rpc('increment_visits').then(() => {}).catch(() => {});

/* ================= پنل مدیریت ================= */
const adminPage = document.getElementById('adminPage');
document.getElementById('adminPanelBtn').addEventListener('click', () => {
  closeAccountPanel();
  openAdminPage();
});
document.getElementById('adminBackBtn').addEventListener('click', () => { adminPage.classList.remove('open'); });

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // ۲ دقیقه

function relativeTimeFa(dateStr){
  if(!dateStr) return 'هیچ‌وقت وارد نشده';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if(diffMin < 1) return 'همین الان';
  if(diffMin < 60) return `${diffMin} دقیقه پیش`;
  const diffHr = Math.floor(diffMin / 60);
  if(diffHr < 24) return `${diffHr} ساعت پیش`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} روز پیش`;
}

async function loadAdminsStatus(){
  const listEl = document.getElementById('adminsStatusList');
  listEl.innerHTML = admSkel();
  const { data: adminRows, error } = await db.from('admins').select('phone');
  if(error || !adminRows || adminRows.length === 0){
    listEl.innerHTML = '<p>هیچ مدیری ثبت نشده.</p>';
    return;
  }
  const phones = adminRows.map(a => a.phone);
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [{ data: profilesData }, { data: sessData }] = await Promise.all([
    db.from('profiles').select('phone, full_name, last_seen').in('phone', phones),
    db.from('admin_sessions').select('phone, started_at, ended_at').in('phone', phones).gte('ended_at', since).order('started_at', { ascending: false }),
  ]);
  const profileByPhone = {};
  (Array.isArray(profilesData) ? profilesData : []).forEach(p => { profileByPhone[p.phone] = p; });
  const sessByPhone = {};
  (Array.isArray(sessData) ? sessData : []).forEach(x => { (sessByPhone[x.phone] = sessByPhone[x.phone] || []).push(x); });

  listEl.innerHTML = `<p class="as-note">زمان‌ها به وقت ایران؛ هر بازه یعنی سایت روی گوشی یا کامپیوتر مدیر باز بوده (حتی پشت برنامه‌های دیگه، تا وقتی دستگاه اجرای سایت رو متوقف نکرده). آنلاین بودن از روز ۱۹ مهر ۱۴۰۵ ثبت می‌شه.</p>` + phones.map(phone => {
    const p = profileByPhone[phone];
    const shown = normalizeIranMobile(phone) || phone;
    const name = (p && p.full_name) ? p.full_name : shown;
    const sess = sessByPhone[phone] || [];
    const lastSeen = [p && p.last_seen, sess[0] && sess[0].ended_at].filter(Boolean).sort().pop() || null;
    const isOnline = !!(lastSeen && (Date.now() - new Date(lastSeen).getTime()) < ONLINE_THRESHOLD_MS);
    const now = isOnline && sess[0] && Date.now() - new Date(sess[0].ended_at).getTime() < ONLINE_THRESHOLD_MS ? sess[0] : null;
    const status = isOnline
      ? `<em class="as-on">آنلاین${now ? ' از ساعت ' + faClock(now.started_at) : ''}</em>`
      : `<em>${lastSeen ? 'آخرین بازدید: ' + faDayLabel(lastSeen) + '، ساعت ' + faClock(lastSeen) : 'هنوز وارد نشده'}</em>`;
    // the last 7 days, one line per day, newest first
    const days = [];
    sess.forEach(x => {
      const key = new Date(x.started_at).toDateString();
      let d = days.find(y => y.key === key);
      if(!d){ d = { key, at: x.started_at, items: [] }; days.push(d); }
      d.items.push(x);
    });
    const dayHtml = days.map(d => `<div class="as-day"><b>${faDayLabel(d.at)}</b><span>${toFa(Math.round(d.items.reduce((m, x) => m + (new Date(x.ended_at) - new Date(x.started_at)), 0) / 60000))} دقیقه</span>
      <div class="as-chips">${d.items.slice().reverse().map(x => {
        const live = x === now;
        const mins = Math.round((new Date(x.ended_at) - new Date(x.started_at)) / 60000);
        return `<i class="${live ? 'live' : ''}">${faClock(x.started_at)} تا ${live ? 'الان' : faClock(x.ended_at)}<small>${mins < 1 ? 'کمتر از ۱ دقیقه' : faDuration(mins)}</small></i>`;
      }).join('')}</div></div>`).join('');
    return `<div class="admin-status-row as-row">
      <div class="as-top">
        <div><b>${escapeHtml(name)}<span class="online-dot ${isOnline ? 'on' : 'off'}"></span></b>${name !== shown ? `<span dir="ltr" class="as-phone">${escapeHtml(shown)}</span>` : ''}</div>
        ${status}
      </div>
      ${dayHtml ? `<div class="as-days">${dayHtml}</div>` : '<p class="as-empty">در ۷ روز اخیر آنلاین نبوده.</p>'}
    </div>`;
  }).join('');
}
// exact clock / day labels for the admins' online history
function faClock(iso){ return new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }); }
function faDayLabel(iso){
  const tz = { timeZone: 'Asia/Tehran' };
  const day = d => new Date(d).toLocaleDateString('en-CA', tz);
  if(day(iso) === day(Date.now())) return 'امروز';
  if(day(iso) === day(Date.now() - 864e5)) return 'دیروز';
  return new Date(iso).toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', ...tz });
}
function faDuration(mins){
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${toFa(h)} ساعت${m ? ' و ' + toFa(m) + ' دقیقه' : ''}` : `${toFa(m)} دقیقه`;
}

let heartbeatInterval = null;
async function sendHeartbeat(){
  if(!currentUser) return;
  // any time the site is open counts as online, in view or in the background, as long as the device keeps it running
  db.rpc('admin_heartbeat').then(() => {}, () => {});
  await db.from('profiles').upsert({ id: currentUser.id, phone: currentUser.phone, last_seen: new Date().toISOString() });
}
document.addEventListener('visibilitychange', () => { if(heartbeatInterval && document.visibilityState === 'visible') sendHeartbeat(); });
window.addEventListener('online', () => { if(heartbeatInterval) sendHeartbeat(); });
function startHeartbeat(){
  if(heartbeatInterval) return;
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, 45000);
}
function stopHeartbeat(){
  if(heartbeatInterval){ clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

// shimmering placeholder rows in the shape of the cards that are about to load
function admSkel(n = 3, tiles = false){
  const row = '<div class="sk-row"><i class="sk sk-av"></i><span><i class="sk sk-l1"></i><i class="sk sk-l2"></i></span><i class="sk sk-pill"></i></div>';
  return '<div class="sk-wrap" aria-label="در حال بارگذاری" role="status">' + (tiles ? '<div class="sk-tiles"><i class="sk"></i><i class="sk"></i></div>' : '') + row.repeat(n) + '</div>';
}
function openAdminPage(){
  const first = (currentProfile && currentProfile.full_name || '').trim().split(/\s+/)[0];
  document.getElementById('admToday').textContent = (first ? 'سلام ' + first + ' · ' : '') + new Date().toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' });
  admCounted = false;
  adminPage.classList.add('open');
  adminPage.scrollTop = 0;
  switchAdminTab('orders');
}

function switchAdminTab(tab){
  const moreBtn = document.getElementById('admMoreBtn');
  if(moreBtn) moreBtn.classList.toggle('on', ['reviews', 'coupons', 'announce', 'logs', 'admins'].includes(tab));
  document.getElementById('adminPage').classList.toggle('on-products', tab === 'products');
  // lists cascade in when a section opens, not on every search keystroke
  const ap = document.getElementById('adminPage');
  ap.classList.add('entering'); clearTimeout(ap._enterT); ap._enterT = setTimeout(() => ap.classList.remove('entering'), 1600);
  if(document.getElementById('adminPage').classList.contains('open')) document.getElementById('adminPage').scrollTo({ top: 0 });
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('adminTabOrders').style.display = tab === 'orders' ? 'block' : 'none';
  document.getElementById('adminTabProducts').style.display = tab === 'products' ? 'block' : 'none';
  document.getElementById('adminTabStats').style.display = tab === 'stats' ? 'block' : 'none';
  document.getElementById('adminTabReviews').style.display = tab === 'reviews' ? 'block' : 'none';
  document.getElementById('adminTabCustomers').style.display = tab === 'customers' ? 'block' : 'none';
  document.getElementById('adminTabCoupons').style.display = tab === 'coupons' ? 'block' : 'none';
  document.getElementById('adminTabLogs').style.display = tab === 'logs' ? 'block' : 'none';
  document.getElementById('adminTabAdmins').style.display = tab === 'admins' ? 'block' : 'none';
  document.getElementById('adminTabAnnounce').style.display = tab === 'announce' ? 'block' : 'none';
  if(tab === 'announce') loadAdminAnnouncement();
  if(tab === 'orders'){ loadAdminOrders(); clearNewOrderBadge(); }
  if(tab === 'products') loadAdminProducts();
  if(tab === 'stats') loadAdminStats();
  if(tab === 'reviews') loadAdminReviews();
  if(tab === 'customers') loadAdminCustomers();
  if(tab === 'coupons') loadAdminCoupons();
  if(tab === 'logs') loadAdminLogs();
  if(tab === 'admins') loadAdminsStatus();
}
document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.addEventListener('click', () => switchAdminTab(btn.dataset.tab));
});

// «پرداخت شده» is set automatically when Zibal confirms a payment; the shop then confirms or cancels by hand
const ORDER_STATUSES = ['در انتظار پرداخت', 'پرداخت شده', 'جدید', 'تایید شده', 'ارسال شده', 'تحویل داده شده', 'لغو شده'];

function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let adminOrdersCache = [];
let adminOrdersProductMap = {};
let adminOrderFilter = 'all';
const TODO_CONFIRM = ['پرداخت شده', 'جدید'];   // money in (or a card-to-card order): confirm it
const TODO_SHIP = ['تایید شده'];                // confirmed: pack it and enter the tracking code

async function loadAdminOrders(){
  const listEl = document.getElementById('adminOrdersList');
  listEl.innerHTML = admSkel();
  syncPayModeRadios();
  const { data: rows, error } = await db.from('orders').select('*').order('created_at', { ascending: false });
  if(error){ listEl.innerHTML = '<p style="font-size:13px;color:var(--coffee-70);">خواندن سفارش‌ها ناموفق بود.</p>'; return; }
  adminOrdersCache = rows || [];
  const allIds = [...new Set(adminOrdersCache.flatMap(o => (o.items || []).map(i => i.id)))];
  adminOrdersProductMap = {};
  if(allIds.length){
    const { data: productsData } = await db.from('products').select('id, image_url').in('id', allIds);
    (productsData || []).forEach(p => { adminOrdersProductMap[p.id] = p; });
  }
  renderAdminOrders();
}

const latinDigits = v => String(v || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
function orderMatches(o, q){
  if(!q) return true;
  const digits = latinDigits(q).replace(/\D/g, '');
  const hay = normFa([o.customer_name, o.customer_address, o.customer_note, o.tracking_code, o.post_tracking, o.pay_ref_number,
    ...(o.items || []).map(i => i.name + ' ' + (i.variant || ''))].join(' '));
  if(hay.includes(normFa(latinDigits(q)))) return true;
  if(digits.length >= 4){
    const phone = latinDigits(o.customer_phone).replace(/\D/g, '').replace(/^98/, '0');
    if(phone.includes(digits.replace(/^98/, '0')) || String(o.tracking_code || '').includes(digits)) return true;
  }
  return false;
}

function renderAdminTodo(rows){
  const confirm = rows.filter(o => TODO_CONFIRM.includes(o.status)).length;
  const ship = rows.filter(o => TODO_SHIP.includes(o.status)).length;
  const waiting = adminOrdersCache.filter(o => o.status === PAY_PENDING).length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sold = adminOrdersCache.filter(o => new Date(o.created_at) >= today && o.status !== 'لغو شده' && o.status !== PAY_PENDING && !o.pay_sandbox);
  const KICO = { sales: '<path d="M3 7h18v12H3z"/><path d="M16 13h2M3 10h18"/>', confirm: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    ship: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17.5" cy="17.5" r="1.6"/>', wait: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>' };
  const tile = (key, n, text, hot, ico) => `<button type="button" class="kpi${hot && n ? ' hot' : ''}" ${key ? `onclick="${key}"` : 'disabled'}><i class="kpi-ico k-${ico}"><svg viewBox="0 0 24 24" aria-hidden="true">${KICO[ico]}</svg></i><b data-n="${n}">${toFa(n)}</b><span>${text}</span></button>`;
  const spark = admSalesSpark();
  document.getElementById('adminTodo').innerHTML =
    tile('', sold.reduce((a, o) => a + (o.total || 0), 0), `فروش امروز به تومان، از ${toFa(sold.length)} سفارش`, false, 'sales').replace('</button>', `${spark.delta}${spark.svg}</button>`)
    + tile("setAdminOrderFilter('todo-confirm')", confirm, 'منتظر تایید', true, 'confirm')
    + tile("setAdminOrderFilter('todo-ship')", ship, 'منتظر ارسال', true, 'ship')
    + tile('showUnpaidOrders()', waiting, 'منتظر پرداخت مشتری', false, 'wait');
  admCountUp();
}
// the KPI figures count up once each time the panel opens
let admCounted = false;
function admCountUp(){
  if(admCounted || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  admCounted = true;
  const els = [...document.querySelectorAll('#adminTodo .kpi b[data-n]')];
  const t0 = performance.now(), D = 900;
  const step = now => {
    const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
    els.forEach(el => { el.textContent = toFa(Math.round(+el.dataset.n * e)); });
    if(k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function admMore(open){
  document.getElementById('admMore').classList.toggle('open', open);
  document.getElementById('admMoreOverlay').classList.toggle('open', open);
  document.getElementById('admMoreBtn').classList.toggle('on', open);
}
document.getElementById('admMoreBtn').addEventListener('click', () => admMore(!document.getElementById('admMore').classList.contains('open')));
document.getElementById('admMoreOverlay').addEventListener('click', () => admMore(false));
document.querySelectorAll('#admMore [data-go]').forEach(b => b.addEventListener('click', () => {
  admMore(false); switchAdminTab(b.dataset.go);
  // keep «بیشتر» lit while one of its sections is open
  document.getElementById('admMoreBtn').classList.add('on');
}));
document.querySelectorAll('#admQuick [data-q]').forEach(b => b.addEventListener('click', () => {
  const q = b.dataset.q;
  if(q === 'product'){ switchAdminTab('products'); document.getElementById('adminAddProductBtn').click(); }
  else if(q === 'manual'){ adminPage.classList.remove('open'); showToast('محصول‌ها رو به سبد اضافه کن، موقع ثبت گزینه‌ی «سفارش دستی» رو بزن'); }
  else switchAdminTab(q);
}));
document.getElementById('admFab').addEventListener('click', () => {
  document.getElementById('adminAddProductBtn').click();
  document.getElementById('adminPage').scrollTo({ top: 0, behavior: 'smooth' });
});
// last 7 days of real sales for the sparkline on the sales tile
function admSalesSpark(){
  const day = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const today = day(Date.now());
  const sums = Array(7).fill(0);
  adminOrdersCache.forEach(o => {
    if(o.status === 'لغو شده' || o.status === PAY_PENDING || o.pay_sandbox) return;
    const k = Math.round((today - day(o.created_at)) / 864e5);
    if(k >= 0 && k < 7) sums[6 - k] += o.total || 0;
  });
  const max = Math.max(1, ...sums), W = 120, H = 34;
  const pts = sums.map((v, i) => [i * W / 6, H - 3 - (v / max) * (H - 8)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const y = sums[5], t = sums[6];
  const delta = y ? Math.round((t - y) / y * 100) : null;
  return { svg: `<svg class="kpi-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${line} L${W} ${H} L0 ${H} Z" class="a"/><path d="${line}" class="l"/><circle cx="${pts[6][0]}" cy="${pts[6][1]}" r="2.6"/></svg>`,
    delta: delta === null ? '' : `<em class="kpi-delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${toFa(Math.abs(delta))}٪ نسبت به دیروز</em>` };
}
function setAdminOrderFilter(key){
  adminOrderFilter = key;
  renderAdminOrders();
  document.getElementById('adminOrderChips').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function showUnpaidOrders(){
  document.getElementById('adminShowUnpaid').checked = true;
  setAdminOrderFilter(PAY_PENDING);
}

const STATUS_TONE = { 'در انتظار پرداخت': 'wait', 'پرداخت شده': 'paid', 'جدید': 'paid', 'تایید شده': 'ok', 'ارسال شده': 'sent', 'تحویل داده شده': 'done', 'لغو شده': 'cancel' };
function admWhen(iso){
  const d = new Date(iso), t = new Date(); t.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  if(d >= t) return 'امروز، ' + time;
  if(d >= t - 864e5) return 'دیروز، ' + time;
  return d.toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' }) + '، ' + time;
}
function renderAdminOrders(){
  const listEl = document.getElementById('adminOrdersList');
  // orders still waiting for payment, or dropped without paying, stay out of the way unless asked for
  const showUnpaid = document.getElementById('adminShowUnpaid').checked;
  const visible = adminOrdersCache.filter(o => showUnpaid || !isAbandonedOrder(o));
  const hidden = adminOrdersCache.length - visible.length;
  renderAdminTodo(visible);

  // status chips with counts
  const counts = {};
  visible.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
  const chips = [['all', 'همه', visible.length], ['todo-confirm', 'منتظر تایید', visible.filter(o => TODO_CONFIRM.includes(o.status)).length],
    ['todo-ship', 'منتظر ارسال', visible.filter(o => TODO_SHIP.includes(o.status)).length],
    ...ORDER_STATUSES.filter(st => counts[st]).map(st => [st, st, counts[st]])];
  if(!chips.some(c => c[0] === adminOrderFilter)) adminOrderFilter = 'all';
  document.getElementById('adminOrderChips').innerHTML = chips.map(([key, label, n]) =>
    `<button type="button" class="${key === adminOrderFilter ? 'on' : ''}" onclick="setAdminOrderFilter(${escapeHtml(JSON.stringify(key))})">${label}<i>${toFa(n)}</i></button>`).join('');

  const q = document.getElementById('adminOrderSearch').value.trim();
  const data = visible.filter(o =>
    (adminOrderFilter === 'all' || (adminOrderFilter === 'todo-confirm' ? TODO_CONFIRM.includes(o.status)
      : adminOrderFilter === 'todo-ship' ? TODO_SHIP.includes(o.status) : o.status === adminOrderFilter))
    && orderMatches(o, q));

  if(data.length === 0){
    listEl.innerHTML = `<p style="font-size:13px;color:var(--coffee-70);">${adminOrdersCache.length === 0 ? 'هنوز سفارشی ثبت نشده.' : q ? 'سفارشی با این مشخصات پیدا نشد.' : 'سفارشی در این بخش نیست.'}${hidden && !showUnpaid ? ` (${toFa(hidden)} سفارش پرداخت‌نشده مخفیه)` : ''}</p>`;
    return;
  }
  const productMap = adminOrdersProductMap;
  listEl.innerHTML = data.map(o => {
    const tone = STATUS_TONE[o.status] || 'ok';
    const statusOptions = ORDER_STATUSES.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('');
    const itemsHtml = (o.items || []).map(i => {
      const prod = productMap[i.id];
      const img = prod && prod.image_url ? thumbUrl(prod.image_url.split(/[,،]/).map(s => s.trim()).filter(Boolean)[0]) : null;
      return `
        <div class="admin-order-item">
          <div class="admin-order-item-visual">${img ? `<img src="${img}" alt="${escapeHtml(i.name)}" onerror="thumbFallback(this)">` : icons.necklace}</div>
          <div class="admin-order-item-info">
            <div class="name">${escapeHtml(i.name)}${i.variant ? ` <span class="variant">(${escapeHtml(i.variant)})</span>` : ''}</div>
            <div class="qty-price">${toFa(i.qty)} عدد × ${toFa(i.price)} تومان = ${toFa(i.qty * i.price)} تومان</div>
          </div>
        </div>`;
    }).join('');
    return `<div class="admin-card tone-${tone}">
      ${admSteps(o)}
      <div class="admin-card-top">
        <div class="ao-who"><b>${escapeHtml(o.customer_name) || '-'}</b><span>${admWhen(o.created_at)}${o.tracking_code ? ` — کد <span class="ao-code">${escapeHtml(o.tracking_code)}</span>` : ''}</span></div>
        <select class="admin-status-select tone-${tone}" onchange="updateOrderStatus('${o.id}', this.value)">${statusOptions}</select>
      </div>
      <dl class="ao-info">
        <dt>موبایل</dt><dd><a class="ao-phone" href="tel:${escapeHtml(o.customer_phone || '')}">${escapeHtml(o.customer_phone) || '-'}</a></dd>
        <dt>آدرس</dt><dd>${escapeHtml(o.customer_address) || '-'}${o.customer_address ? ` <button type="button" class="ao-copy" data-copy="${escapeHtml([o.customer_name, o.customer_phone, o.customer_address].filter(Boolean).join('\n'))}" onclick="admCopy(this)">کپی برای برچسب پست</button>` : ''}</dd>
        ${o.customer_note ? `<dt>یادداشت</dt><dd>${escapeHtml(o.customer_note)}</dd>` : ''}
      </dl>
      <div class="admin-order-items">${itemsHtml}</div>
      ${adminPayLine(o)}
      ${o.coupon_code ? `<div class="admin-card-meta">کد تخفیف: ${escapeHtml(o.coupon_code)} (${toFa(o.discount_amount || 0)} تومان تخفیف)</div>` : ''}
      <div class="ao-total"><span>جمع سفارش</span><b>${toFa(o.total)} <small>تومان</small></b></div>
      ${admNextBtn(o)}
      ${o.status === 'لغو شده' || o.status === PAY_PENDING || TODO_CONFIRM.includes(o.status) ? '' : `<div class="ship-box${TODO_SHIP.includes(o.status) ? ' next' : ''}">
        ${TODO_SHIP.includes(o.status) ? '<b class="ship-next">قدم بعدی: کد رهگیری رو بزن تا سفارش «ارسال شده» بشه</b>' : ''}
        <select id="shipCarrier-${o.id}">${SHIP_CARRIERS.map(c => `<option${(o.post_carrier || 'پست') === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
        <input id="shipCode-${o.id}" maxlength="60" placeholder="کد رهگیری مرسوله" value="${escapeHtml(o.post_tracking || '')}">
        <button onclick="saveShipping(${o.id})">${o.post_tracking ? 'ذخیره‌ی تغییر' : 'ثبت ارسال'}</button>
        <span class="ship-note">مشتری کد رو در «سفارش‌های من» می‌بینه.</span>
      </div>`}
      <button class="adm-danger-link" onclick="deleteAdminOrder(${o.id})">حذف سفارش</button>
    </div>`;
  }).join('');
}
document.getElementById('adminOrderSearch').addEventListener('input', renderAdminOrders);

// where the order is on its way: placed → confirmed → shipped → delivered
const ADM_STEPS = ['ثبت', 'تایید', 'ارسال', 'تحویل'];
function admSteps(o){
  const at = TODO_CONFIRM.includes(o.status) ? 0 : o.status === 'تایید شده' ? 1 : o.status === 'ارسال شده' ? 2 : o.status === 'تحویل داده شده' ? 3 : -1;
  if(at < 0) return '';
  return `<ol class="ao-steps" aria-label="مرحله‌ی سفارش">${ADM_STEPS.map((t, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><i></i><span>${t}</span></li>`).join('')}</ol>`;
}
// the one obvious next move for this order, one tap
function admNextBtn(o){
  const ico = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  if(TODO_CONFIRM.includes(o.status)) return `<button type="button" class="ao-next" onclick="admAdvance('${o.id}', 'تایید شده', this)">${ico}تایید سفارش</button>`;
  if(o.status === 'ارسال شده') return `<button type="button" class="ao-next soft" onclick="admAdvance('${o.id}', 'تحویل داده شده', this)">${ico}به دست مشتری رسید</button>`;
  return '';
}
async function admAdvance(id, status, btn){
  btn.disabled = true; btn.classList.add('busy');
  await updateOrderStatus(id, status);
  renderAdminOrders();
}
function admCopy(btn){
  const text = btn.dataset.copy;
  const done = () => { const t = btn.textContent; btn.textContent = 'کپی شد'; btn.classList.add('ok'); setTimeout(() => { btn.textContent = t; btn.classList.remove('ok'); }, 1600); };
  if(navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => showToast('کپی نشد'));
  else showToast('کپی نشد');
}

function isAbandonedOrder(o){
  return o.status === PAY_PENDING || (o.status === 'لغو شده' && (o.cancel_reason === 'expired' || o.cancel_reason === 'replaced'));
}
const MANUAL_PAY_LABEL = { card: 'پرداخت شده (کارت‌به‌کارت)', cod: 'پرداخت در محل', unpaid: 'هنوز پرداخت نشده' };
function adminPayLine(o){
  if(o.manual_pay){
    return `<div class="admin-card-meta"><span class="ao-manual">ثبت دستی${o.source ? ' · ' + escapeHtml(o.source) : ''}</span><br>${MANUAL_PAY_LABEL[o.manual_pay] || ''}${o.discount_amount ? ` · تخفیف: ${toFa(o.discount_amount)} تومان` : ''}</div>`;
  }
  const test = o.pay_sandbox ? ' <span class="pay-badge test" style="margin:0;">آزمایشی</span>' : '';
  if(o.payment_status === 'paid'){
    return `<div class="admin-card-meta" style="color:#3f5e3a;">✓ پرداخت آنلاین شد: ${toFa(Math.round((o.pay_amount || 0) / 10))} تومان${o.pay_ref_number ? ` · شماره پیگیری: <span style="direction:ltr;unicode-bidi:isolate;">${escapeHtml(o.pay_ref_number)}</span>` : ''}${o.pay_card ? ` · کارت: <span style="direction:ltr;unicode-bidi:isolate;">${escapeHtml(o.pay_card)}</span>` : ''}${test}</div>`;
  }
  if(o.status === PAY_PENDING) return `<div class="admin-card-meta" style="color:#7a5a1c;">منتظر پرداخت مشتری${o.payment_status === 'failed' ? ' (آخرین تلاش ناموفق بود)' : o.payment_status === 'pending' ? ' (رفته به درگاه)' : ''} — اگه پرداخت نشه خودکار لغو می‌شه.${test}</div>`;
  if(o.status === 'لغو شده' && o.cancel_reason === 'expired') return `<div class="admin-card-meta">لغو خودکار: مهلت پرداخت تموم شد.${test}</div>`;
  if(o.status === 'لغو شده' && o.cancel_reason === 'replaced') return `<div class="admin-card-meta">رها شد: مشتری سفارش تازه‌تری ثبت کرد.${test}</div>`;
  if(o.payment_status === 'free') return '<div class="admin-card-meta">مبلغ صفر (با کد تخفیف)</div>';
  return '';
}
function syncPayModeRadios(){
  document.querySelectorAll('input[name="payMode"]').forEach(r => { r.checked = r.value === paymentMode; });
  const now = document.getElementById('payModeNow');
  now.textContent = { off: 'خاموش', test: 'آزمایشی', live: 'فعال' }[paymentMode] || '';
  now.className = 'pm-' + paymentMode;
}
document.querySelectorAll('input[name="payMode"]').forEach(r => r.addEventListener('change', async () => {
  const mode = r.value;
  if(mode === 'live' && !confirm('پرداخت آنلاین برای همه‌ی مشتری‌ها فعال بشه؟\nقبلش مطمئن شو کد پذیرنده‌ی زیبال (ZIBAL_MERCHANT) رو در Supabase گذاشتی و یه بار در حالت آزمایشی تست کردی.')){
    syncPayModeRadios();
    return;
  }
  const { error } = await db.from('site_settings').upsert({ key: 'payment', value: { mode }, updated_at: new Date().toISOString() });
  if(error){ console.error(error); showToast('ذخیره نشد، دوباره امتحان کن'); syncPayModeRadios(); return; }
  paymentMode = mode;
  updatePayLabels();
  logAdminAction('تغییر پرداخت آنلاین', { off: 'خاموش', test: 'آزمایشی', live: 'فعال' }[mode]);
  showToast(mode === 'live' ? 'پرداخت آنلاین برای همه فعال شد' : mode === 'test' ? 'حالت آزمایشی فعال شد؛ فقط مدیرها با درگاه آزمایشی پرداخت می‌کنن' : 'پرداخت آنلاین خاموش شد');
}));
document.getElementById('adminShowUnpaid').addEventListener('change', renderAdminOrders);

const SHIP_CARRIERS = ['پست', 'تیپاکس', 'چاپار', 'پیک', 'سایر'];

// save carrier + tracking code and mark the order shipped; the customer sees it under My orders
async function saveShipping(orderId){
  const code = document.getElementById('shipCode-' + orderId).value.trim();
  const carrier = document.getElementById('shipCarrier-' + orderId).value;
  if(!code){ showToast('کد رهگیری مرسوله رو وارد کن'); return; }
  const { error } = await db.from('orders').update({ post_tracking: code, post_carrier: carrier, status: 'ارسال شده' }).eq('id', orderId);
  if(error){ console.error(error); showToast('ذخیره نشد، دوباره امتحان کن'); return; }
  logAdminAction('ثبت کد رهگیری', `سفارش #${orderId}: ${carrier} ${code}`);
  showToast('ثبت شد؛ مشتری کد رهگیری رو در سفارش‌هاش می‌بینه');
  loadAdminOrders();
}

async function deleteAdminOrder(id){
  if(!confirm('مطمئنی می‌خوای این سفارش رو حذف کنی؟ اگه سفارش هنوز ارسال نشده، موجودی‌اش به انبار برمی‌گرده.')) return;
  const { error } = await db.from('orders').delete().eq('id', id);
  if(error){ console.error(error); showToast('حذف سفارش ناموفق بود'); return; }
  logAdminAction('حذف سفارش', `شناسه #${id}`);
  loadAdminOrders();
  showToast('سفارش حذف شد');
}

document.getElementById('deleteAllOrdersBtn').addEventListener('click', async () => {
  if(!confirm('مطمئنی می‌خوای همه‌ی سفارش‌ها رو حذف کنی؟ این کار قابل بازگشت نیست.')) return;
  if(!confirm('برای اطمینان دوباره تایید کن: همه‌ی سفارش‌ها برای همیشه پاک می‌شن.')) return;
  await db.from('orders').delete().gte('id', 0);
  logAdminAction('حذف همه‌ی سفارش‌ها', '');
  loadAdminOrders();
  showToast('همه‌ی سفارش‌ها حذف شدن');
});

// stock is handled in the database: an order takes its items out of stock,
// cancelling (or deleting it before shipping) puts them back
async function updateOrderStatus(orderId, status){
  const { error } = await db.from('orders').update({ status }).eq('id', orderId);
  if(error){ console.error(error); showToast('تغییر وضعیت ناموفق بود'); loadAdminOrders(); return; }
  logAdminAction('تغییر وضعیت سفارش', `سفارش #${orderId} به «${status}»`);
  const cached = adminOrdersCache.find(o => String(o.id) === String(orderId));
  if(cached){ cached.status = status; renderAdminTodo(adminOrdersCache.filter(o => document.getElementById('adminShowUnpaid').checked || !isAbandonedOrder(o))); }
  showToast(status === 'لغو شده' ? 'سفارش لغو شد و موجودی‌اش به انبار برگشت' : 'وضعیت سفارش به‌روزرسانی شد');
}

let adminProductsCache = [];
let adminProductCat = 'all';
async function loadAdminProducts(){
  const listEl = document.getElementById('adminProductsList');
  listEl.innerHTML = admSkel();
  const { data, error } = await db.from('products').select('*').order('id', { ascending: false });
  if(error || !data){
    listEl.innerHTML = '<p style="font-size:13px;color:var(--coffee-70);">مشکلی تو بارگذاری محصولات پیش اومد.</p>';
    return;
  }
  adminProductsCache = data;
  renderAdminProducts();
}
function setAdminProductCat(cat){ adminProductCat = cat; renderAdminProducts(); }
// category chips (with counts) + search by name, colour or model
function renderAdminProducts(){
  const listEl = document.getElementById('adminProductsList');
  const all = adminProductsCache;
  const counts = {};
  all.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
  const lowStock = all.filter(p => (Number(p.stock) || 0) <= 1).length;
  const chips = [['all', 'همه', all.length], ...Object.keys(CAT_LABELS).filter(c => counts[c]).map(c => [c, CAT_LABELS[c], counts[c]]),
    ...Object.keys(counts).filter(c => !CAT_LABELS[c]).map(c => [c, (all.find(p => p.category === c) || {}).category_label || c, counts[c]]),
    ...(lowStock ? [['low', 'موجودی کم', lowStock]] : [])];
  if(!chips.some(c => c[0] === adminProductCat)) adminProductCat = 'all';
  document.getElementById('adminProductChips').innerHTML = chips.map(([key, label, n]) =>
    `<button type="button" class="${key === adminProductCat ? 'on' : ''}" onclick="setAdminProductCat(${escapeHtml(JSON.stringify(key))})">${escapeHtml(label)} (${toFa(n)})</button>`).join('');
  const q = normFa(latinDigits(document.getElementById('adminProductSearch').value.trim()));
  const data = all.filter(p =>
    (adminProductCat === 'all' || (adminProductCat === 'low' ? (Number(p.stock) || 0) <= 1 : p.category === adminProductCat))
    && (!q || normFa(latinDigits([p.name, p.variants, p.description, p.category_label, String(p.price)].join(' '))).includes(q)));
  if(data.length === 0){
    listEl.innerHTML = `<p style="font-size:13px;color:var(--coffee-70);">${all.length ? 'محصولی با این مشخصات پیدا نشد.' : 'هنوز محصولی اضافه نشده.'}</p>`;
    return;
  }
  listEl.innerHTML = data.map(p => {
    const img = (p.image_url || '').split(/[,،]/).map(x => x.trim()).filter(Boolean)[0];
    const stock = Number(p.stock) || 0;
    return `
    <div class="admin-prod-row">
      <div class="ap-img">${img ? `<img src="${thumbUrl(img)}" alt="" loading="lazy" onerror="thumbFallback(this)">` : icons.necklace}</div>
      <div class="ap-info">
        <b>${escapeHtml(p.name)}</b>
        <span>${escapeHtml(p.category_label || p.category)}، ${toFa(p.price)} تومان${adminSaleTag(p)}</span>
        <em class="ap-stock ${stock <= 0 ? 'out' : stock <= 1 ? 'low' : ''}">${stock <= 0 ? 'ناموجود' : 'موجودی ' + toFa(stock)}</em>
      </div>
      <div class="admin-prod-actions">
        <button onclick="editAdminProduct(${p.id})">ویرایش</button>
        <button class="del" onclick="deleteAdminProduct(${p.id})" aria-label="حذف ${escapeHtml(p.name)}">حذف</button>
      </div>
    </div>`;
  }).join('');
}
document.getElementById('adminProductSearch').addEventListener('input', renderAdminProducts);

function resetAdminProductForm(){
  document.getElementById('adminProdId').value = '';
  document.getElementById('adminProdName').value = '';
  document.getElementById('adminProdCat').value = 'necklace';
  document.getElementById('adminProdPrice').value = '';
  document.getElementById('adminProdSalePrice').value = '';
  document.getElementById('adminProdStock').value = '';
  document.getElementById('adminProdImage').value = '';
  document.getElementById('adminProdVariants').value = '';
  document.getElementById('adminProdDesc').value = '';
  document.getElementById('adminProdIsNew').checked = false;
  document.getElementById('adminProdSaleStart').value = '';
  document.getElementById('adminProdSaleEnd').value = '';
  document.getElementById('adminProdError').classList.remove('show');
  adminPendingUploads = [];
  renderAdminProdImagePreview();
}

let adminPendingUploads = [];

function getAdminProdImages(){
  return document.getElementById('adminProdImage').value.split(',').map(s => s.trim()).filter(Boolean);
}
function setAdminProdImages(arr){
  document.getElementById('adminProdImage').value = arr.join(',');
  renderAdminProdImagePreview();
}
function renderAdminProdImagePreview(){
  const imgs = getAdminProdImages();
  // order matters: the first photo is the cover on the store; the arrows move a photo one place, the star makes it the cover
  const doneHtml = imgs.map((url, i) => `
    <div class="admin-img-thumb${i === 0 ? ' is-cover' : ''}">
      <img src="${escapeHtml(viaRelay(url))}" loading="lazy">
      <button type="button" class="ait-del" onclick="removeAdminProdImage(${i})" aria-label="حذف عکس">×</button>
      ${i === 0 ? '<span class="ait-cover">کاور</span>' : `<button type="button" class="ait-star" onclick="moveAdminProdImage(${i}, 0)" aria-label="عکس اصلی بشه">★</button>`}
      <span class="ait-nav">
        <button type="button" onclick="moveAdminProdImage(${i}, ${i - 1})" ${i === 0 ? 'disabled' : ''} aria-label="یکی جلوتر">→</button>
        <b>${toFa(i + 1)}</b>
        <button type="button" onclick="moveAdminProdImage(${i}, ${i + 1})" ${i === imgs.length - 1 ? 'disabled' : ''} aria-label="یکی عقب‌تر">←</button>
      </span>
    </div>
  `).join('');
  const pendingHtml = adminPendingUploads.map(() => `
    <div class="admin-img-thumb admin-img-thumb-pending"><div class="admin-img-spinner"></div></div>
  `).join('');
  document.getElementById('adminProdImagePreview').innerHTML = doneHtml + pendingHtml;
}
function moveAdminProdImage(from, to){
  const imgs = getAdminProdImages();
  if(to < 0 || to >= imgs.length || from === to) return;
  const [it] = imgs.splice(from, 1);
  imgs.splice(to, 0, it);
  setAdminProdImages(imgs);
}
function removeAdminProdImage(i){
  const imgs = getAdminProdImages();
  imgs.splice(i, 1);
  setAdminProdImages(imgs);
}
document.getElementById('adminProdImage').addEventListener('input', renderAdminProdImagePreview);

// phone photos are 3-7 MB; shrink to max 1600px JPEG (~200-400 KB) before they reach the site
async function compressImageFile(file, maxSide = 1600, quality = 0.82){
  try{
    let src;
    if(window.createImageBitmap){
      src = await createImageBitmap(file);
    } else {
      src = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = URL.createObjectURL(file);
      });
    }
    const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
    const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    if(src.close) src.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : null;
  }catch(e){
    return null; // e.g. a format the browser cannot decode: upload the original
  }
}

// card-size copy of a product photo, stored as thumbs/<same name>
async function uploadThumbFor(path, source){
  if(!/^products\/[^/]+\.jpg$/.test(path)) return false;
  const thumb = await compressImageFile(source, 640, 0.8);
  if(!thumb) return false;
  const { error } = await db.storage.from('image').upload(path.replace(/^products\//, 'thumbs/'), thumb, {
    cacheControl: '31536000', upsert: false, contentType: 'image/jpeg'
  });
  return !error;
}

async function handleAdminImageFiles(files){
  if(!files.length) return;
  const statusEl = document.getElementById('adminProdImageUploadStatus');
  for(const file of files){
    const pendingId = Math.random().toString(36).slice(2);
    adminPendingUploads.push(pendingId);
    renderAdminProdImagePreview();
    statusEl.textContent = `در حال آماده‌سازی ${file.name}...`;
    const small = await compressImageFile(file);
    const ext = small ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await db.storage.from('image').upload(path, small || file, {
      cacheControl: '31536000', upsert: false, contentType: small ? 'image/jpeg' : (file.type || undefined)
    });
    adminPendingUploads = adminPendingUploads.filter(id => id !== pendingId);
    if(error){
      console.error('خطا در آپلود عکس:', error);
      statusEl.textContent = `آپلود ${file.name} ناموفق بود.`;
      renderAdminProdImagePreview();
      continue;
    }
    if(small) await uploadThumbFor(path, file);
    const { data: pub } = db.storage.from('image').getPublicUrl(path);
    const imgs = getAdminProdImages();
    imgs.push(toDirect(pub.publicUrl));
    setAdminProdImages(imgs);
  }
  statusEl.textContent = '';
}

document.getElementById('adminProdImageFile').addEventListener('change', (e) => {
  handleAdminImageFiles(Array.from(e.target.files || []));
  e.target.value = '';
});

const adminImgDropZone = document.getElementById('adminImgDropZone');
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
['dragenter', 'dragover'].forEach(evt => adminImgDropZone.addEventListener(evt, e => {
  e.preventDefault();
  adminImgDropZone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(evt => adminImgDropZone.addEventListener(evt, e => {
  e.preventDefault();
  adminImgDropZone.classList.remove('dragover');
}));
adminImgDropZone.addEventListener('drop', e => {
  const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
  handleAdminImageFiles(files);
});

async function optimizeExistingProductImages(){
  const btn = document.getElementById('adminOptimizeImagesBtn');
  const statusEl = document.getElementById('adminOptimizeStatus');
  btn.disabled = true;
  statusEl.textContent = 'در حال خواندن محصولات...';
  const { data, error } = await db.from('products').select('id, image_url');
  if(error || !data){
    statusEl.textContent = 'خواندن محصولات ناموفق بود.';
    btn.disabled = false;
    return;
  }
  const split = v => (v || '').split(/[,،]/).map(s => s.trim()).filter(Boolean);
  const total = data.reduce((n, p) => n + split(p.image_url).length, 0);
  let done = 0, shrunk = 0, failed = 0, savedBytes = 0, thumbsMade = 0;
  for(const p of data){
    const urls = split(p.image_url);
    const out = [];
    let changed = false;
    for(const url of urls){
      done++;
      statusEl.textContent = `در حال کوچک کردن عکس ${toFa(done)} از ${toFa(total)}...`;
      if(!url.includes('/storage/v1/object/public/image/')){ out.push(url); continue; }
      try{
        const res = await fetch(url, { cache: 'no-store' });
        if(!res.ok) throw new Error('download ' + res.status);
        const blob = await res.blob();
        const small = blob.size > 600 * 1024 ? await compressImageFile(blob) : null;
        if(!small){
          out.push(url);
          const m = url.match(/\/image\/(products\/[^/?#]+\.jpg)$/);
          if(m){
            const head = await fetch(thumbUrl(url), { method: 'HEAD', cache: 'no-store' }).catch(() => null);
            if(!head || !head.ok){ if(await uploadThumbFor(m[1], blob)) thumbsMade++; }
          }
          continue;
        }
        const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const up = await db.storage.from('image').upload(path, small, { cacheControl: '31536000', upsert: false, contentType: 'image/jpeg' });
        if(up.error) throw up.error;
        if(await uploadThumbFor(path, small)) thumbsMade++;
        out.push(toDirect(db.storage.from('image').getPublicUrl(path).data.publicUrl));
        savedBytes += blob.size - small.size;
        shrunk++;
        changed = true;
      }catch(e){
        console.error('بهینه‌سازی عکس ناموفق:', url, e);
        failed++;
        out.push(url);
      }
    }
    if(changed){
      const { error: upErr } = await db.from('products').update({ image_url: out.join(',') }).eq('id', p.id);
      if(upErr){ console.error(upErr); failed++; }
    }
  }
  const mb = (savedBytes / 1048576).toFixed(1);
  statusEl.textContent = `تمام شد: ${toFa(shrunk)} عکس کوچک شد (${toFaDigits(mb)} مگابایت کمتر)` + (thumbsMade ? `، ${toFa(thumbsMade)} نسخه‌ی سبک برای کارت‌ها ساخته شد` : '') + (failed ? `، ${toFa(failed)} مورد ناموفق بود؛ دوباره بزنید.` : '.');
  logAdminAction('کوچک کردن عکس‌ها', `${shrunk} عکس، ${mb} MB`);
  btn.disabled = false;
  loadAdminProducts();
  fetchProducts();
}
document.getElementById('adminOptimizeImagesBtn').addEventListener('click', optimizeExistingProductImages);

document.getElementById('adminAddProductBtn').addEventListener('click', () => {
  resetAdminProductForm();
  document.getElementById('adminProductForm').style.display = 'block';
});
document.getElementById('adminProdCancelBtn').addEventListener('click', () => {
  document.getElementById('adminProductForm').style.display = 'none';
});

// ISO timestamp -> value for <input type="datetime-local"> in the admin's own time zone
function toLocalInputValue(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function adminSaleTag(p){
  if(!p.sale_price || !(Number(p.sale_price) < Number(p.price))) return '';
  const now = Date.now();
  const st = p.sale_starts_at ? new Date(p.sale_starts_at).getTime() : null;
  const en = p.sale_ends_at ? new Date(p.sale_ends_at).getTime() : null;
  const fmt = t => new Date(t).toLocaleString('fa-IR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if(st && st > now) return ` · <span style="color:#8a6d2b;">حراج از ${fmt(st)}</span>`;
  if(en && en <= now) return ` · <span style="color:var(--coffee-70);">حراج تموم شده</span>`;
  return ` · <span style="color:#8B3A3A;">حراج فعال${en ? ' تا ' + fmt(en) : ''}</span>`;
}
async function editAdminProduct(id){
  const { data: p } = await db.from('products').select('*').eq('id', id).maybeSingle();
  if(!p) return;
  document.getElementById('adminProdId').value = p.id;
  document.getElementById('adminProdName').value = p.name || '';
  document.getElementById('adminProdCat').value = p.category || 'necklace';
  document.getElementById('adminProdPrice').value = p.price || '';
  document.getElementById('adminProdSalePrice').value = p.sale_price || '';
  document.getElementById('adminProdStock').value = p.stock || 0;
  document.getElementById('adminProdImage').value = p.image_url || '';
  document.getElementById('adminProdVariants').value = p.variants || '';
  document.getElementById('adminProdDesc').value = p.description || '';
  document.getElementById('adminProdIsNew').checked = !!p.is_new;
  document.getElementById('adminProdSaleStart').value = toLocalInputValue(p.sale_starts_at);
  document.getElementById('adminProdSaleEnd').value = toLocalInputValue(p.sale_ends_at);
  renderAdminProdImagePreview();
  document.getElementById('adminProductForm').style.display = 'block';
  document.getElementById('adminProductForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const CAT_LABELS = { necklace: 'گردنبند', earring: 'گوشواره', bracelet: 'دستبند', ring: 'انگشتر', anklet: 'پابند', hair: 'اکسسوری مو' };

document.getElementById('adminProdSaveBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('adminProdError');
  errorEl.classList.remove('show');
  const id = document.getElementById('adminProdId').value;
  const name = document.getElementById('adminProdName').value.trim();
  const category = document.getElementById('adminProdCat').value;
  const price = Number(document.getElementById('adminProdPrice').value);
  const salePriceRaw = document.getElementById('adminProdSalePrice').value;
  const stock = Number(document.getElementById('adminProdStock').value || 0);
  const imageUrl = document.getElementById('adminProdImage').value.trim();
  const variants = document.getElementById('adminProdVariants').value.trim();
  const description = document.getElementById('adminProdDesc').value.trim();
  const isNew = document.getElementById('adminProdIsNew').checked;
  const saleStartRaw = document.getElementById('adminProdSaleStart').value;
  const saleEndRaw = document.getElementById('adminProdSaleEnd').value;

  if(!name || !price){
    errorEl.textContent = 'نام و قیمت محصول الزامیه.';
    errorEl.classList.add('show');
    return;
  }
  if((saleStartRaw || saleEndRaw) && !salePriceRaw){
    errorEl.textContent = 'برای زمان‌بندی حراج، قیمت تخفیف‌خورده رو هم وارد کن.';
    errorEl.classList.add('show');
    return;
  }
  if(saleStartRaw && saleEndRaw && new Date(saleEndRaw) <= new Date(saleStartRaw)){
    errorEl.textContent = 'زمان پایان حراج باید بعد از زمان شروعش باشه.';
    errorEl.classList.add('show');
    return;
  }

  const payload = {
    name,
    category,
    category_label: CAT_LABELS[category] || category,
    price,
    sale_price: salePriceRaw ? Number(salePriceRaw) : null,
    stock,
    image_url: imageUrl || null,
    variants: variants || null,
    description: description || null,
    is_new: isNew,
    sale_starts_at: saleStartRaw ? new Date(saleStartRaw).toISOString() : null,
    sale_ends_at: saleEndRaw ? new Date(saleEndRaw).toISOString() : null,
  };

  const btn = document.getElementById('adminProdSaveBtn');
  btn.disabled = true;
  btn.textContent = 'در حال ذخیره...';
  const { error } = id
    ? await db.from('products').update(payload).eq('id', id)
    : await db.from('products').insert([payload]);
  btn.disabled = false;
  btn.textContent = 'ذخیره';

  if(error){
    console.error('خطا در ذخیره‌ی محصول:', error);
    errorEl.textContent = 'مشکلی پیش اومد، دوباره امتحان کن.';
    errorEl.classList.add('show');
    return;
  }
  document.getElementById('adminProductForm').style.display = 'none';
  logAdminAction(id ? 'ویرایش محصول' : 'افزودن محصول', name);
  loadAdminProducts();
  fetchProducts();
  showToast(id ? 'محصول ویرایش شد' : 'محصول جدید اضافه شد');
});

async function deleteAdminProduct(id){
  if(!confirm('مطمئنی می‌خوای این محصول رو حذف کنی؟')) return;
  const { error } = await db.from('products').delete().eq('id', id);
  if(error){ console.error(error); showToast('حذف محصول ناموفق بود'); return; }
  logAdminAction('حذف محصول', `شناسه #${id}`);
  loadAdminProducts();
  fetchProducts();
  showToast('محصول حذف شد');
}

async function loadAdminReviews(){
  const listEl = document.getElementById('adminReviewsList');
  listEl.innerHTML = admSkel();
  const { data, error } = await db.from('reviews').select('*, products(name)').order('created_at', { ascending: false });
  if(error || !data){
    listEl.innerHTML = '<p style="font-size:13px;color:var(--coffee-70);">مشکلی تو بارگذاری نظرات پیش اومد.</p>';
    return;
  }
  if(data.length === 0){
    listEl.innerHTML = '<p style="font-size:13px;color:var(--coffee-70);">هنوز نظری ثبت نشده.</p>';
    return;
  }
  listEl.innerHTML = data.map(r => `
    <div class="admin-card">
      <div class="admin-card-top">
        <b>${escapeHtml(r.author_name)} — ${r.products ? escapeHtml(r.products.name) : 'محصول حذف‌شده'}</b>
        <span style="font-size:11.5px;padding:3px 10px;background:${r.approved ? 'var(--tan)' : '#F3D9D9'};color:var(--coffee);">${r.approved ? 'تاییدشده' : 'در انتظار تایید'}</span>
      </div>
      ${starsHtml(r.rating)}
      <div class="admin-card-items">${escapeHtml(r.comment)}</div>
      <div class="admin-prod-actions" style="margin-top:8px;">
        ${!r.approved ? `<button onclick="approveAdminReview(${r.id})">تایید</button>` : ''}
        <button onclick="deleteAdminReview(${r.id})">حذف</button>
      </div>
    </div>
  `).join('');
}

async function approveAdminReview(id){
  const { error } = await db.from('reviews').update({ approved: true }).eq('id', id);
  if(error){ console.error(error); showToast('تایید نظر ناموفق بود'); return; }
  logAdminAction('تایید نظر', `شناسه #${id}`);
  loadAdminReviews();
  loadTestimonials();
  showToast('نظر تایید شد');
}

async function deleteAdminReview(id){
  if(!confirm('مطمئنی می‌خوای این نظر رو حذف کنی؟')) return;
  const { error } = await db.from('reviews').delete().eq('id', id);
  if(error){ console.error(error); showToast('حذف نظر ناموفق بود'); return; }
  logAdminAction('حذف نظر', `شناسه #${id}`);
  loadAdminReviews();
  loadTestimonials();
  showToast('نظر حذف شد');
}

document.getElementById('anaDays').addEventListener('change', loadAdminAnalytics);

const pct = (a, b) => b > 0 ? toFaDigits((100 * a / b).toFixed(a / b < 0.1 ? 1 : 0)) + '٪' : '—';
async function loadAdminAnalytics(){
  const days = Number(document.getElementById('anaDays').value);
  const totalsEl = document.getElementById('adminAnaTotals');
  const prodEl = document.getElementById('adminProductStatsBox');
  prodEl.innerHTML = '<p class="ana-empty">در حال بارگذاری...</p>';
  const { data, error } = await db.rpc('admin_analytics', { p_days: days });
  if(error || !data){ prodEl.innerHTML = '<p class="ana-empty">آمار خوانده نشد.</p>'; return; }
  const t = data.totals || {};
  totalsEl.innerHTML = `<b>${toFa(t.visits)}</b> بازدیدکننده · <b>${toFa(t.viewers)}</b> نفر محصول دیدن · <b>${toFa(t.carts)}</b> نفر به سبد اضافه کردن · <b>${toFa(t.orders)}</b> سفارش · <b>${toFa(t.revenue)}</b> تومان فروش · نرخ خرید ${pct(t.orders, t.visits)}`;
  const prods = data.products || [];
  prodEl.innerHTML = prods.length ? `<div class="ana-wrap"><table class="ana-table">
    <tr><th>محصول</th><th>دیده شده</th><th>افزودن به سبد</th><th>فروخته شده</th><th>نرخ خرید</th></tr>
    ${prods.slice(0, 40).map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${toFa(r.views)}</td><td>${toFa(r.carts)}</td><td>${toFa(r.sold)}</td><td>${pct(r.sold, r.views)}</td></tr>`).join('')}
  </table></div>` : '<p class="ana-empty">هنوز کسی محصولی رو باز نکرده.</p>';
}

// sales over the last 24 hours and 3 days (rolling windows from now), with visitors from the analytics
async function loadRecentStats(orders, now){
  const box = document.getElementById('adminRecentStats');
  const windows = [{ label: '۲۴ ساعت اخیر', days: 1 }, { label: '۳ روز اخیر', days: 3 }];
  const card = (w, a) => {
    const since = now.getTime() - w.days * 864e5;
    const list = orders.filter(o => new Date(o.created_at).getTime() >= since);
    const revenue = list.reduce((s, o) => s + (o.total || 0), 0);
    const t = (a && a.totals) || {};
    return `<div class="recent-card"><h5>${w.label}</h5>
      <span class="rc-lbl">فروش</span><div class="rc-main">${toFa(revenue)} <small>تومان</small></div>
      <ul><li><span>سفارش</span><b>${toFa(list.length)}</b></li>
        <li><span>بازدیدکننده</span><b>${a ? toFa(t.visits || 0) : '…'}</b></li>
        <li><span>افزودن به سبد</span><b>${a ? toFa(t.carts || 0) : '…'}</b></li></ul></div>`;
  };
  box.innerHTML = windows.map(w => card(w, null)).join('');
  const res = await Promise.all(windows.map(w => db.rpc('admin_analytics', { p_days: w.days }).then(r => r.data).catch(() => null)));
  box.innerHTML = windows.map((w, i) => card(w, res[i] || { totals: {} })).join('');
}

async function loadAdminStats(){
  loadAdminAnalytics();
  const box = document.getElementById('adminStatsBox');
  box.innerHTML = admSkel(2, true);
  const { data: allOrders } = await db.from('orders').select('total, created_at, items, status, pay_sandbox');
  // cancelled, still-unpaid and test-gateway orders are not sales
  const orders = (allOrders || []).filter(o => o.status !== 'لغو شده' && o.status !== PAY_PENDING && !o.pay_sandbox);
  const { data: stats } = await db.from('site_stats').select('visits').eq('id', 1).maybeSingle();

  const totalRevenue = (orders || []).reduce((s, o) => s + (o.total || 0), 0);
  const totalOrders = (orders || []).length;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ordersToday = (orders || []).filter(o => new Date(o.created_at) >= startOfToday).length;
  const visits = stats ? stats.visits : 0;

  box.innerHTML = `
    <div class="stat-box">
      <div class="stat-item"><b>${toFa(totalRevenue)}</b><span>جمع کل فروش (تومان)</span></div>
      <div class="stat-item"><b>${toFa(totalOrders)}</b><span>تعداد کل سفارش‌ها</span></div>
      <div class="stat-item"><b>${toFa(ordersToday)}</b><span>سفارش‌های امروز</span></div>
      <div class="stat-item"><b>${toFa(visits)}</b><span>تعداد بازدید سایت</span></div>
    </div>
  `;

  loadRecentStats(orders, now);

  // نمودار فروش ۷ روز اخیر
  const days = [];
  for(let i = 6; i >= 0; i--){
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - i);
    days.push({ date: d, total: 0 });
  }
  (orders || []).forEach(o => {
    const d = new Date(o.created_at);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const match = days.find(x => x.date.getTime() === dayStart);
    if(match) match.total += (o.total || 0);
  });
  const maxTotal = Math.max(1, ...days.map(x => x.total));
  document.getElementById('adminSalesChart').innerHTML = `
    <div class="sales-chart">
      ${days.map(x => `
        <div class="sales-bar-col">
          <span class="sales-bar-val">${x.total > 0 ? toFa(x.total) : ''}</span>
          <div class="sales-bar" style="height:${Math.max(2, Math.round(x.total / maxTotal * 100))}%;"></div>
          <span class="sales-bar-day">${toFa(x.date.getDate())}</span>
        </div>
      `).join('')}
    </div>
  `;

  // پرفروش‌ترین محصولات
  const soldQty = {};
  (orders || []).forEach(o => {
    (o.items || []).forEach(i => {
      soldQty[i.name] = (soldQty[i.name] || 0) + (i.qty || 0);
    });
  });
  const bestSellers = Object.entries(soldQty).sort((a,b) => b[1] - a[1]).slice(0, 5);
  document.getElementById('adminBestSellersBox').innerHTML = bestSellers.length
    ? bestSellers.map(([name, qty]) => `<div class="best-seller-row"><b>${escapeHtml(name)}</b><span>${toFa(qty)} عدد فروخته شده</span></div>`).join('')
    : '<p style="font-size:13px;color:var(--coffee-70);">هنوز فروشی ثبت نشده.</p>';

  // موجودی کم
  const { data: lowStockProducts } = await db.from('products').select('name, stock').lte('stock', LOW_STOCK_THRESHOLD).order('stock', { ascending: true });
  document.getElementById('adminLowStockBox').innerHTML = (lowStockProducts && lowStockProducts.length)
    ? lowStockProducts.map(p => `<div class="low-stock-row"><b>${escapeHtml(p.name)}</b><span>${p.stock === 0 ? 'ناموجود' : `فقط ${toFa(p.stock)} عدد`}</span></div>`).join('')
    : '<p style="font-size:13px;color:var(--coffee-70);">همه محصولات موجودی کافی دارن.</p>';
}

/* ================= مشتری‌ها ================= */
async function loadAdminCustomers(){
  const listEl = document.getElementById('adminCustomersList');
  listEl.innerHTML = admSkel();
  const { data: profilesData, error } = await db.from('profiles').select('id, full_name, phone, blocked').order('updated_at', { ascending: false });
  if(error || !profilesData || profilesData.length === 0){
    listEl.innerHTML = '<p style="font-size:13px;color:var(--coffee-70);">هنوز مشتری‌ای ثبت‌نام نکرده.</p>';
    return;
  }
  const { data: ordersData } = await db.from('orders').select('user_id');
  const orderCountByUser = {};
  (ordersData || []).forEach(o => {
    if(!o.user_id) return;
    orderCountByUser[o.user_id] = (orderCountByUser[o.user_id] || 0) + 1;
  });
  listEl.innerHTML = profilesData.map(p => {
    const count = orderCountByUser[p.id] || 0;
    return `<div class="admin-status-row">
      <div>
        <b>${escapeHtml(p.full_name || p.phone || 'بدون‌نام')}${p.blocked ? ' <span style="color:#8B3A3A;font-size:11.5px;">(مسدود)</span>' : ''}</b>
        <span>${escapeHtml(p.phone || '-')} · ${toFa(count)} سفارش</span>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="admin-status-select" style="cursor:pointer;" onclick="resetCustomerPassword('${p.id}')">ریست رمز</button>
        <button class="admin-status-select" style="cursor:pointer;" onclick="toggleBlockCustomer('${p.id}', ${!p.blocked})">${p.blocked ? 'رفع مسدودی' : 'مسدود کردن'}</button>
      </div>
    </div>`;
  }).join('');
}
async function toggleBlockCustomer(userId, blocked){
  if(blocked && !confirm('مطمئنی می‌خوای این مشتری رو مسدود کنی؟ دیگه نمی‌تونه سفارش ثبت کنه.')) return;
  const { error } = await db.from('profiles').update({ blocked }).eq('id', userId);
  if(error){ console.error(error); showToast('انجام نشد، دوباره امتحان کن'); return; }
  logAdminAction(blocked ? 'مسدود کردن مشتری' : 'رفع مسدودی مشتری', `شناسه ${userId}`);
  loadAdminCustomers();
  showToast(blocked ? 'مشتری مسدود شد' : 'مسدودیت مشتری برداشته شد');
}
async function resetCustomerPassword(userId){
  if(!confirm('یه رمز جدید و تصادفی برای این مشتری ساخته می‌شه و رمز قبلیش دیگه کار نمی‌کنه. ادامه بدم؟')) return;
  const { data, error } = await db.functions.invoke('admin-reset-customer-password', { body: { userId } });
  if(error || !data || data.error || !data.newPassword){
    showToast('مشکلی پیش اومد، دوباره امتحان کن.');
    console.error('خطا در ریست رمز:', error || (data && data.error));
    return;
  }
  logAdminAction('ریست رمز مشتری', `شناسه ${userId}`);
  window.prompt('رمز جدید این مشتری (کپی کن و بهش اطلاع بده، این پیام دیگه تکرار نمی‌شه):', data.newPassword);
}

/* ================= کدهای تخفیف ================= */
document.getElementById('adminAddCouponBtn').addEventListener('click', () => {
  document.getElementById('couponCode').value = '';
  document.getElementById('couponType').value = 'percent';
  document.getElementById('couponValue').value = '';
  document.getElementById('couponMaxUses').value = '';
  document.getElementById('couponExpiry').value = '';
  document.getElementById('couponOncePerCustomer').checked = false;
  document.getElementById('couponError').classList.remove('show');
  document.getElementById('adminCouponForm').style.display = 'block';
});
document.getElementById('couponCancelBtn').addEventListener('click', () => {
  document.getElementById('adminCouponForm').style.display = 'none';
});
document.getElementById('couponSaveBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('couponError');
  errorEl.classList.remove('show');
  const code = document.getElementById('couponCode').value.trim().toUpperCase();
  const discount_type = document.getElementById('couponType').value;
  const discount_value = Number(document.getElementById('couponValue').value);
  const maxUsesRaw = document.getElementById('couponMaxUses').value;
  const expiryRaw = document.getElementById('couponExpiry').value;

  if(!code || !discount_value || discount_value <= 0){
    errorEl.textContent = 'کد و مقدار تخفیف الزامیه.';
    errorEl.classList.add('show');
    return;
  }
  if(maxUsesRaw && (!Number.isInteger(Number(maxUsesRaw)) || Number(maxUsesRaw) < 1)){
    errorEl.textContent = 'حداکثر تعداد استفاده باید یک عدد صحیح بزرگ‌تر از صفر باشه.';
    errorEl.classList.add('show');
    return;
  }
  if(discount_type === 'percent' && discount_value > 100){
    errorEl.textContent = 'تخفیف درصدی نمی‌تونه بیشتر از ۱۰۰ باشه.';
    errorEl.classList.add('show');
    return;
  }
  if(!/^[A-Z0-9_-]+$/.test(code)){
    errorEl.textContent = 'کد تخفیف فقط می‌تونه شامل حروف انگلیسی، عدد، خط تیره و آندرلاین باشه.';
    errorEl.classList.add('show');
    return;
  }
  const payload = {
    code,
    discount_type,
    discount_value,
    max_uses: maxUsesRaw ? Number(maxUsesRaw) : null,
    expires_at: expiryRaw ? new Date(expiryRaw).toISOString() : null,
    one_per_customer: document.getElementById('couponOncePerCustomer').checked,
  };
  const btn = document.getElementById('couponSaveBtn');
  btn.disabled = true;
  btn.textContent = 'در حال ذخیره...';
  const { error } = await db.from('coupons').upsert(payload);
  btn.disabled = false;
  btn.textContent = 'ذخیره';
  if(error){
    console.error('خطا در ذخیره‌ی کد تخفیف:', error);
    errorEl.textContent = 'مشکلی پیش اومد، دوباره امتحان کن (شاید این کد قبلاً ثبت شده).';
    errorEl.classList.add('show');
    return;
  }
  logAdminAction('ذخیره کد تخفیف', code);
  document.getElementById('adminCouponForm').style.display = 'none';
  loadAdminCoupons();
  showToast('کد تخفیف ذخیره شد');
});
async function loadAdminCoupons(){
  const listEl = document.getElementById('adminCouponsList');
  listEl.innerHTML = admSkel();
  const { data, error } = await db.from('coupons').select('*').order('created_at', { ascending: false });
  if(error || !data || data.length === 0){
    listEl.innerHTML = '<p style="font-size:13px;color:var(--coffee-70);">هنوز کد تخفیفی ساخته نشده.</p>';
    return;
  }
  listEl.innerHTML = data.map(c => {
    const valueText = c.discount_type === 'percent' ? `${toFa(c.discount_value)}٪` : `${toFa(c.discount_value)} تومان`;
    const usesText = c.max_uses !== null ? `${toFa(c.used_count)} از ${toFa(c.max_uses)} استفاده` : `${toFa(c.used_count)} بار استفاده شده`;
    const expiryText = c.expires_at ? new Date(c.expires_at).toLocaleDateString('fa-IR') : 'بدون انقضا';
    return `<div class="coupon-row">
      <div>
        <b>${escapeHtml(c.code)}</b> <span class="coupon-badge ${c.active ? 'active' : 'inactive'}">${c.active ? 'فعال' : 'غیرفعال'}</span>${c.one_per_customer ? ' <span class="coupon-badge active">هر مشتری یک بار</span>' : ''}
        <div><span>${valueText} · ${usesText} · انقضا: ${expiryText}</span></div>
      </div>
      <div class="admin-prod-actions">
        <button onclick="toggleCouponActive('${c.code}', ${!c.active})">${c.active ? 'غیرفعال کردن' : 'فعال کردن'}</button>
        <button onclick="toggleCouponOnce('${c.code}', ${!c.one_per_customer})">${c.one_per_customer ? 'استفاده‌ی نامحدود برای هر مشتری' : 'فقط یک بار برای هر مشتری'}</button>
        <button onclick="deleteCoupon('${c.code}')">حذف</button>
      </div>
    </div>`;
  }).join('');
}
async function toggleCouponActive(code, active){
  const { error } = await db.from('coupons').update({ active }).eq('code', code);
  if(error){ console.error(error); showToast('انجام نشد، دوباره امتحان کن'); return; }
  logAdminAction(active ? 'فعال کردن کد تخفیف' : 'غیرفعال کردن کد تخفیف', code);
  loadAdminCoupons();
  showToast(active ? 'کد تخفیف فعال شد' : 'کد تخفیف غیرفعال شد');
}
async function toggleCouponOnce(code, once){
  const { error } = await db.from('coupons').update({ one_per_customer: once }).eq('code', code);
  if(error){ console.error(error); showToast('انجام نشد، دوباره امتحان کن'); return; }
  logAdminAction(once ? 'کد تخفیف: هر مشتری یک بار' : 'کد تخفیف: بدون محدودیت برای هر مشتری', code);
  loadAdminCoupons();
  showToast(once ? 'از این به بعد هر مشتری فقط یک بار می‌تونه از این کد استفاده کنه' : 'محدودیت یک بار برای هر مشتری برداشته شد');
}
async function deleteCoupon(code){
  if(!confirm('مطمئنی می‌خوای این کد تخفیف رو حذف کنی؟')) return;
  const { error } = await db.from('coupons').delete().eq('code', code);
  if(error){ console.error(error); showToast('حذف کد تخفیف ناموفق بود'); return; }
  logAdminAction('حذف کد تخفیف', code);
  loadAdminCoupons();
  showToast('کد تخفیف حذف شد');
}

/* ================= اطلاعیه‌ی بالای سایت ================= */
// the bar's look is data (preset or custom colours, animation, speed, icon, size) saved with the text in site_settings;
// colours are only ever set as validated #rrggbb custom properties, never as raw CSS
const ANN_PRESETS = {
  mocha:     { name: 'قهوه‌ای کلاسیک', c1: '#6F533F', c2: '#8E6E58', ct: '#F7F2EA', ca: '#E6C38A' },
  champagne: { name: 'شامپاینی',       c1: '#E9D7BC', c2: '#F7EEDF', ct: '#5A4232', ca: '#B08A4E' },
  noir:      { name: 'مشکی و طلا',     c1: '#141110', c2: '#2A231E', ct: '#F3E6CF', ca: '#D9B26A' },
  rose:      { name: 'رزگلد',          c1: '#B97A6E', c2: '#D9A79A', ct: '#FFF6F1', ca: '#FCE2C8' },
  ivory:     { name: 'کرم روشن',       c1: '#FBF6EE', c2: '#F1E6D6', ct: '#6B5647', ca: '#B8956F' },
  emerald:   { name: 'زمردی',          c1: '#1F3B33', c2: '#2E5246', ct: '#F1EADA', ca: '#D6B97A' },
};
const ANN_ANIMS = { shine: 'درخشش طلایی', marquee: 'متن روان', pulse: 'تپش نرم', glow: 'هاله‌ی نور', drop: 'فقط ورود', none: 'بدون انیمیشن' };
const ANN_SPEEDS = { slow: 'آرام', normal: 'معمولی', fast: 'سریع' };
const ANN_SIZES = { sm: 'کوچک', md: 'متوسط', lg: 'بزرگ' };
const ANN_SVG = {
  spark: '<path d="M12 1.5C12.9 8 16 11.1 22.5 12 16 12.9 12.9 16 12 22.5 11.1 16 8 12.9 1.5 12 8 11.1 11.1 8 12 1.5Z"/>',
  gift: '<path d="M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10.5 3 8 3.6 7 7 12 7zM12 7s1.5-4 4-3.4S17 7 12 7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  truck: '<path d="M2 7h11v9H2zM13 10h4.5l3.5 3.5V16h-8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="6" cy="17.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="17" cy="17.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.6"/>',
  heart: '<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.2 1.7-2 3.2-3.2 5.3-3.2 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/>',
};
const ANN_ICONS = { spark: 'ستاره', gift: 'هدیه', truck: 'ارسال', tag: 'تخفیف', heart: 'قلب', none: 'بدون' };
const ANN_DEFAULT = { preset: 'mocha', anim: 'shine', speed: 'normal', icon: 'spark', size: 'md' };
const hexOk = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
function annStyle(v){
  v = v || {};
  const pick = (val, list, def) => Object.prototype.hasOwnProperty.call(list, val) ? val : def;
  const preset = v.preset === 'custom' ? 'custom' : pick(v.preset, ANN_PRESETS, ANN_DEFAULT.preset);
  const base = ANN_PRESETS[preset] || ANN_PRESETS.mocha;
  const c = v.colors || {};
  const colors = preset === 'custom'
    ? { c1: hexOk(c.c1) ? c.c1 : base.c1, c2: hexOk(c.c2) ? c.c2 : base.c2, ct: hexOk(c.ct) ? c.ct : base.ct, ca: hexOk(c.ca) ? c.ca : base.ca }
    : { c1: base.c1, c2: base.c2, ct: base.ct, ca: base.ca };
  return { preset, colors, anim: pick(v.anim, ANN_ANIMS, ANN_DEFAULT.anim), speed: pick(v.speed, ANN_SPEEDS, ANN_DEFAULT.speed),
    icon: pick(v.icon, ANN_ICONS, ANN_DEFAULT.icon), size: pick(v.size, ANN_SIZES, ANN_DEFAULT.size) };
}
function safeAnnounceLink(link){
  const l = String(link || '').trim();
  return /^https?:\/\//i.test(l) || /^#[\w-]*$/.test(l) ? l : '';
}
function fillAnnounceBar(bar, value, forPreview){
  const st = annStyle(value);
  bar.innerHTML = '';
  bar.className = `announce-bar${forPreview ? ' announce-preview' : ''} ann-a-${st.anim} ann-s-${st.speed} ann-z-${st.size} ann-i-${st.icon}`;
  bar.style.setProperty('--ann-c1', st.colors.c1);
  bar.style.setProperty('--ann-c2', st.colors.c2);
  bar.style.setProperty('--ann-ct', st.colors.ct);
  bar.style.setProperty('--ann-ca', st.colors.ca);
  const icon = st.icon === 'none' ? '' : `<span class="ann-spark"><svg viewBox="0 0 24 24" aria-hidden="true">${ANN_SVG[st.icon]}</svg></span>`;
  const iconLate = icon.replace('ann-spark', 'ann-spark late');
  const piece = () => {
    const inner = document.createElement('span');
    inner.className = 'ann-inner';
    const span = document.createElement('span');
    span.className = 'ann-text';
    span.textContent = value.text || '';
    inner.insertAdjacentHTML('beforeend', icon);
    inner.appendChild(span);
    inner.insertAdjacentHTML('beforeend', iconLate);
    return inner;
  };
  const link = safeAnnounceLink(value.link);
  const linkEl = () => {
    const a = document.createElement('a');
    a.href = link; a.textContent = String(value.linkLabel || '').trim().slice(0, 20) || 'مشاهده';
    if(/^https?:/i.test(link)){ a.target = '_blank'; a.rel = 'noopener'; }
    if(forPreview) a.addEventListener('click', e => e.preventDefault());
    return a;
  };
  if(st.anim === 'marquee'){
    // two identical runs side by side so the loop has no gap; the second copy is hidden from screen readers
    const track = document.createElement('span');
    track.className = 'ann-track';
    for(let k = 0; k < 2; k++){
      const run = document.createElement('span');
      run.className = 'ann-run';
      if(k) run.setAttribute('aria-hidden', 'true');
      for(let r = 0; r < 3; r++){ run.appendChild(piece()); if(link) run.appendChild(linkEl()); }
      track.appendChild(run);
    }
    bar.appendChild(track);
    return;
  }
  bar.appendChild(piece());
  if(link) bar.appendChild(linkEl());
}
async function loadAnnouncement(){
  const bar = document.getElementById('announceBar');
  const { data } = await db.from('site_settings').select('value').eq('key', 'announcement').maybeSingle();
  const v = data && data.value;
  // stays up for everyone while the admin has it switched on; there is no close button
  if(!v || !v.active || !String(v.text || '').trim()){ bar.hidden = true; return; }
  fillAnnounceBar(bar, v, false);
  bar.hidden = false;
}
loadAnnouncement();

// ---- admin studio ----
let annDraft = { ...ANN_DEFAULT };
function annFormValue(){
  return { ...annDraft,
    text: document.getElementById('announceTextInput').value.trim(),
    link: document.getElementById('announceLinkInput').value.trim(),
    linkLabel: document.getElementById('announceLinkLabel').value.trim(),
    active: document.getElementById('announceActiveInput').checked };
}
function renderAnnounceStudio(){
  const st = annStyle(annDraft);
  document.getElementById('announcePresets').innerHTML = Object.entries(ANN_PRESETS).map(([k, p]) =>
    `<button type="button" class="an-preset${st.preset === k ? ' on' : ''}" data-preset="${k}"><i style="background:linear-gradient(90deg,${p.c1},${p.c2},${p.c1})"><em style="color:${p.ct}">Aa</em><s style="background:${p.ca}"></s></i><span>${p.name}</span></button>`).join('')
    + `<button type="button" class="an-preset${st.preset === 'custom' ? ' on' : ''}" data-preset="custom"><i class="an-preset-custom" style="background:linear-gradient(90deg,${st.colors.c1},${st.colors.c2},${st.colors.c1})"><em style="color:${st.colors.ct}">Aa</em><s style="background:${st.colors.ca}"></s></i><span>سفارشی</span></button>`;
  const chips = (id, list, cur, key) => { document.getElementById(id).innerHTML = Object.entries(list).map(([k, n]) =>
    `<button type="button" class="${cur === k ? 'on' : ''}" data-${key}="${k}">${n}</button>`).join(''); };
  chips('announceAnims', ANN_ANIMS, st.anim, 'anim');
  chips('announceSpeed', ANN_SPEEDS, st.speed, 'speed');
  chips('announceSizes', ANN_SIZES, st.size, 'size');
  document.getElementById('announceIcons').innerHTML = Object.entries(ANN_ICONS).map(([k, n]) =>
    `<button type="button" class="${st.icon === k ? 'on' : ''}" data-icon="${k}" title="${n}">${k === 'none' ? n : `<svg viewBox="0 0 24 24" aria-hidden="true">${ANN_SVG[k]}</svg>`}</button>`).join('');
  document.getElementById('announceSpeed').closest('.form-field').classList.toggle('off', st.anim === 'none' || st.anim === 'drop');
  [['annC1', 'c1'], ['annC2', 'c2'], ['annCt', 'ct'], ['annCa', 'ca']].forEach(([id, k]) => { document.getElementById(id).value = st.colors[k]; });
  const text = document.getElementById('announceTextInput').value;
  document.getElementById('announceCount').textContent = `${toFa(text.length)} / ۱۶۰`;
  const v = annFormValue();
  fillAnnounceBar(document.getElementById('announcePreview'), { ...v, text: v.text || 'متن اطلاعیه این‌جا دیده می‌شه' }, true);
}
function renderAnnouncePreview(){ renderAnnounceStudio(); }
async function loadAdminAnnouncement(){
  const { data } = await db.from('site_settings').select('value').eq('key', 'announcement').maybeSingle();
  const v = (data && data.value) || {};
  const st = annStyle(v);
  annDraft = { preset: st.preset, colors: { ...st.colors }, anim: st.anim, speed: st.speed, icon: st.icon, size: st.size };
  document.getElementById('announceTextInput').value = v.text || '';
  document.getElementById('announceLinkInput').value = v.link || '';
  document.getElementById('announceLinkLabel').value = v.linkLabel || '';
  document.getElementById('announceActiveInput').checked = !!v.active;
  document.getElementById('announceCustom').open = st.preset === 'custom';
  document.getElementById('announceError').classList.remove('show');
  renderAnnounceStudio();
}
['announceTextInput', 'announceLinkInput', 'announceLinkLabel'].forEach(id => document.getElementById(id).addEventListener('input', renderAnnounceStudio));
document.getElementById('announceActiveInput').addEventListener('change', renderAnnounceStudio);
document.getElementById('adminTabAnnounce').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b) return;
  if(b.dataset.preset){
    if(b.dataset.preset === 'custom'){ annDraft.colors = { ...annStyle(annDraft).colors }; document.getElementById('announceCustom').open = true; }
    annDraft.preset = b.dataset.preset;
  }
  else if(b.dataset.anim) annDraft.anim = b.dataset.anim;
  else if(b.dataset.speed) annDraft.speed = b.dataset.speed;
  else if(b.dataset.icon) annDraft.icon = b.dataset.icon;
  else if(b.dataset.size) annDraft.size = b.dataset.size;
  else return;
  renderAnnounceStudio();
});
[['annC1', 'c1'], ['annC2', 'c2'], ['annCt', 'ct'], ['annCa', 'ca']].forEach(([id, k]) => document.getElementById(id).addEventListener('input', e => {
  if(annDraft.preset !== 'custom'){ annDraft.colors = { ...annStyle(annDraft).colors }; annDraft.preset = 'custom'; }
  annDraft.colors = { ...(annDraft.colors || {}), [k]: e.target.value };
  renderAnnounceStudio();
}));
document.getElementById('announceResetBtn').addEventListener('click', () => {
  annDraft = { ...ANN_DEFAULT };
  document.getElementById('announceLinkLabel').value = '';
  document.getElementById('announceCustom').open = false;
  renderAnnounceStudio();
});
document.getElementById('announceSaveBtn').addEventListener('click', async () => {
  const errorEl = document.getElementById('announceError');
  errorEl.classList.remove('show');
  const v = annFormValue();
  if(v.active && !v.text){ errorEl.textContent = 'برای نمایش، متن اطلاعیه رو بنویس.'; errorEl.classList.add('show'); return; }
  if(v.link && !safeAnnounceLink(v.link)){ errorEl.textContent = 'لینک باید با https:// شروع بشه (یا مثل #shop باشه).'; errorEl.classList.add('show'); return; }
  const st = annStyle(v);
  const value = { active: v.active, text: v.text, link: v.link, linkLabel: v.linkLabel.slice(0, 20),
    preset: st.preset, anim: st.anim, speed: st.speed, icon: st.icon, size: st.size, ...(st.preset === 'custom' ? { colors: st.colors } : {}) };
  const { error } = await db.from('site_settings').upsert({ key: 'announcement', value, updated_at: new Date().toISOString() });
  if(error){ console.error(error); errorEl.textContent = 'ذخیره نشد، دوباره امتحان کن.'; errorEl.classList.add('show'); return; }
  try{ localStorage.removeItem('hg-announce-closed'); }catch(e){}
  logAdminAction(v.active ? 'نمایش اطلاعیه' : 'خاموش کردن اطلاعیه', v.text);
  loadAnnouncement();
  showToast(v.active ? 'اطلاعیه روی سایت نمایش داده می‌شه' : 'اطلاعیه از سایت برداشته شد');
});

/* ================= لاگ فعالیت مدیرها ================= */
async function logAdminAction(action, details){
  if(!currentUser || !currentUser.phone) return;
  db.from('admin_logs').insert([{ admin_phone: currentUser.phone, action, details: details || null }]).then(() => {}).catch(() => {});
}
async function loadAdminLogs(){
  const listEl = document.getElementById('adminLogsList');
  listEl.innerHTML = admSkel();
  const { data, error } = await db.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(100);
  if(error || !data || data.length === 0){
    listEl.innerHTML = '<p style="font-size:13px;color:var(--coffee-70);">هنوز فعالیتی ثبت نشده.</p>';
    return;
  }
  listEl.innerHTML = data.map(l => {
    const time = new Date(l.created_at).toLocaleString('fa-IR');
    return `<div class="log-row"><b>${escapeHtml(l.admin_phone)}</b> — ${escapeHtml(l.action)}${l.details ? ' · ' + escapeHtml(l.details) : ''}<span class="log-time">${time}</span></div>`;
  }).join('');
}

/* ================= اعلان سفارش جدید ================= */
let newOrderCount = 0;
let ordersRealtimeChannel = null;
function clearNewOrderBadge(){
  newOrderCount = 0;
  const badgeEl = document.getElementById('newOrderBadge');
  if(badgeEl) badgeEl.remove();
  const navBadge = document.getElementById('admNavBadge');
  if(navBadge) navBadge.hidden = true;
}
function playNotifyBeep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch(e){}
}
function startOrdersRealtime(){
  if(ordersRealtimeChannel) return;
  const announced = new Set(); // a paid order fires a few UPDATEs (payment, SMS flag): alert once
  const announce = (row) => {
    if(!row || announced.has(row.id)) return;
    announced.add(row.id);
    newOrderCount++;
    const ordersTabBtn = document.querySelector('.admin-tab[data-tab="orders"]');
    const navBadge = document.getElementById('admNavBadge');
    if(navBadge){ navBadge.hidden = false; navBadge.textContent = toFa(newOrderCount); }
    if(ordersTabBtn){
      let badgeEl = document.getElementById('newOrderBadge');
      if(!badgeEl){
        badgeEl = document.createElement('span');
        badgeEl.id = 'newOrderBadge';
        badgeEl.className = 'admin-tab-badge';
        ordersTabBtn.appendChild(badgeEl);
      }
      badgeEl.textContent = toFa(newOrderCount);
    }
    if(adminPage.classList.contains('open') && document.getElementById('adminTabOrders').style.display !== 'none'){
      loadAdminOrders();
      clearNewOrderBadge();
    }
    showToast(row.payment_status === 'paid' ? 'سفارش جدید پرداخت شد' : 'سفارش جدید ثبت شد');
    playNotifyBeep();
  };
  ordersRealtimeChannel = db.channel('admin-orders-realtime')
    // orders waiting for online payment are announced once they're paid, not when they're created
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
      // an order an admin typed in by hand is already known to the shop: no beep
      if(payload.new && payload.new.status !== PAY_PENDING && !payload.new.manual_pay) announce(payload.new);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
      const row = payload.new;
      if(row && row.payment_status === 'paid' && row.paid_at && Date.now() - new Date(row.paid_at).getTime() < 2 * 60 * 1000) announce(row);
    })
    .subscribe();
}
function stopOrdersRealtime(){
  if(ordersRealtimeChannel){
    db.removeChannel(ordersRealtimeChannel);
    ordersRealtimeChannel = null;
  }
  clearNewOrderBadge();
}
