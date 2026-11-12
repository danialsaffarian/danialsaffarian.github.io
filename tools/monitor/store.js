// Storefront smoke test on the local copy: layout at four widths, filter, add to cart, product page, cart drawer.
const { chromium } = require('playwright'); const fs = require('fs');
const [,, port] = process.argv;
const { load, route: routeWith } = require('./prods.js');
const prods = load();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const route = p => routeWith(p, prods);
const overflow = p => p.evaluate(() => { const W = document.documentElement.clientWidth; return { doc: document.documentElement.scrollWidth - W, els: [...document.querySelectorAll('body *')].filter(el => { if (el.closest('.checkout-page,[class^=checkout],.filter-row,.admin-tabs,.pd-thumbs,.ann-track,#adminPage,.announce-bar,.hero-deco,svg')) return false; const cs = getComputedStyle(el); if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.right > W + 2 || r.left < -2) && !el.closest('.drawer,.mobile-nav,.product-page:not(.open),.overlay,[class*=marquee]'); }).map(el => (el.className && el.className.toString().slice(0, 40)) || el.tagName).slice(0, 6) }; });
(async () => { const b = await chromium.launch();
  for (const w of [360, 390, 768, 1366]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); await route(p);
    await p.goto(`http://127.0.0.1:${port}/index.html?preview`); await p.waitForTimeout(5000);
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += 600) { await p.evaluate(y => scrollTo(0, y), y); await p.waitForTimeout(60); }
    const o = await overflow(p); ok(o.doc <= 0 && o.els.length === 0, `home ${w}px: no sideways overflow ${JSON.stringify(o)}`);
    const E = f => p.evaluate(f);
    if (w === 390 || w === 1366) {
      await E(() => scrollTo(0, 0));
      // category filter
      await E(() => document.querySelector('.filter-btn[data-cat="earring"]').click()); await p.waitForTimeout(900);
      ok(await E(() => document.querySelector('.filter-btn[data-cat="earring"]').classList.contains('active')), `${w}: category filter activates`);
      ok(await E(() => { const c = [...document.querySelectorAll('#productGrid .card, .grid .card')].filter(x => x.offsetParent); return c.length > 0; }), `${w}: filtered cards visible`);
      // add to cart from a card
      const before = await E(() => document.querySelector('.cart-count').textContent);
      await E(() => { const btn = [...document.querySelectorAll('.card .buy-btn')].find(x => x.offsetParent && !x.disabled); btn.click(); }); await p.waitForTimeout(900);
      ok(await E(() => document.querySelector('.cart-count').textContent) !== before, `${w}: add to cart from card updates badge`);
      // product page
      const id = await E(() => products.find(x => x.variants.length).id);
      await p.evaluate(id => openProductDetail(id), id); await p.waitForTimeout(1000);
      ok(await E(() => { const pg = document.querySelector('.product-page.open'); const btn = pg && pg.querySelector('.pd-buy'); if (!btn) return false; const r = btn.getBoundingClientRect(); const cs = getComputedStyle(btn); return r.width > 100 && cs.color !== cs.backgroundColor; }), `${w}: product page opens with buy button`);
      ok(await E(() => { const off = document.querySelector('.pd-chip.off'); return !!off && getComputedStyle(off).textDecorationLine.includes('line-through'); }), `${w}: sold-out colour chip still struck through`);
      const o2 = await overflow(p); ok(o2.doc <= 0, `${w}: product page no overflow ${JSON.stringify(o2)}`);
      await E(() => addToCartDetail()); await p.waitForTimeout(900);
      ok(await E(() => document.querySelector('.added-bar.show') !== null), `${w}: «به سبد اضافه شد» bar shows`);
      await E(() => openDrawer()); await p.waitForTimeout(900);
      ok(await E(() => { const d = document.querySelector('.drawer'); const cta = d.querySelector('.drawer-cta'); const r = cta.getBoundingClientRect(); return r.width > 100 && r.bottom <= innerHeight + 2 && d.querySelectorAll('.qty-ctrl').length >= 1; }), `${w}: cart drawer shows items and CTA on screen`);
      // contrast of key buttons (text vs background must differ clearly)
      const lum = await E(() => { const L = c => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; }; const b = document.querySelector('.card .buy-btn:not(:disabled)'); const cs = getComputedStyle(b); return { text: L(cs.color), border: cs.borderColor }; });
      ok(lum.text < 0.3, `${w}: card button text is dark on light (${lum.text.toFixed(2)})`);
    }
    ok(errs.length === 0, `home ${w}px: no page errors ${JSON.stringify(errs.slice(0, 2))}`);
    await p.close();
  }
  // static pages that share the stylesheet
  for (const path of ['p/2/', 'c/hair/', 'terms/']) for (const w of [390, 1366]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); await route(p);
    await p.goto(`http://127.0.0.1:${port}/${path}`); await p.waitForTimeout(2500);
    const o = await overflow(p); ok(o.doc <= 0 && o.els.length === 0, `/${path} ${w}px: no overflow ${JSON.stringify(o)}`);
    ok(errs.length === 0, `/${path} ${w}px: no page errors ${JSON.stringify(errs.slice(0, 2))}`);
    await p.close();
  }
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); await b.close(); process.exit(fails ? 1 : 0); })();
