// Colour -> photo: a colour can point at one of the product's photos (4th field of a variant, 1-based).
// Store: picking the colour shows its photo (product page + card), a photo's thumbnail picks its colour, the cart shows
// the colour's photo. Admin: the photo picker under each colour row, and moving / deleting photos keeps the links right.
const { chromium } = require('playwright');
const [,, port] = process.argv;
const { load, route } = require('./prods.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const prods = load();
const P = prods.find(p => p.variants); const B = 'https://goykyskctygnciwttfqj.supabase.co/storage/v1/object/public/image/';
P.image_url = [1, 2, 3].map(n => B + 'ph' + (9000 + n) + '.jpg').join(',');
P.variants = 'طلایی:3::3,نقره‌ای:2::2,رزگلد,برنزی:ناموجود::1';
(async () => { const b = await chromium.launch();
  for (const w of [390, 1366]) {
    const p = await b.newPage({ viewport: { width: w, height: 820 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); await route(p, prods);
    await p.goto(`http://127.0.0.1:${port}/index.html?preview`); await p.waitForTimeout(3500);
    const E = (f, a) => p.evaluate(f, a);
    const shown = () => E(() => (document.getElementById('detailImg').getAttribute('src').match(/ph(\d+)/) || [])[1]);
    await E(id => openProductDetail(id), P.id); await p.waitForTimeout(700);
    ok(await shown() === '9003', `${w}: product opens on the first colour's photo (#3)`);
    await E(() => pickDetailVariant([...document.querySelectorAll('.pd-chip')].find(c => c.dataset.v === 'نقره‌ای'))); await p.waitForTimeout(300);
    ok(await shown() === '9002', `${w}: picking نقره‌ای shows photo #2`);
    await E(() => pickDetailVariant([...document.querySelectorAll('.pd-chip')].find(c => c.dataset.v === 'رزگلد'))); await p.waitForTimeout(300);
    ok(await shown() === '9002', `${w}: a colour without a photo leaves the photo alone`);
    await E(() => document.querySelectorAll('.pd-thumb')[2].click()); await p.waitForTimeout(300);
    ok(await E(() => document.querySelector('.pd-chip.on').dataset.v) === 'طلایی' && await shown() === '9003', `${w}: tapping photo #3 picks طلایی`);
    await E(() => document.querySelectorAll('.pd-thumb')[0].click()); await p.waitForTimeout(300);
    const chipNow = await E(() => document.querySelector('.pd-chip.on').dataset.v);
    ok(chipNow === 'برنزی' && await E(() => document.getElementById('detail-buy-btn').disabled), `${w}: photo #1 picks برنزی (sold out, buy disabled): ${chipNow}`);
    await E(() => pickDetailVariant([...document.querySelectorAll('.pd-chip')].find(c => c.dataset.v === 'نقره‌ای'))); await p.waitForTimeout(200);
    await E(() => { cart.length = 0; addToCartDetail(); }); await p.waitForTimeout(400);
    ok(await E(() => (cart[0].imageUrl.match(/ph(\d+)/) || [])[1]) === '9002', `${w}: cart line keeps the نقره‌ای photo`);
    await E(() => openDrawer()); await p.waitForTimeout(500);
    ok(await E(() => /ph9002/.test(document.querySelector('.drawer .mini-visual img').getAttribute('src'))), `${w}: drawer shows the colour photo`);
    await E(() => { closeDrawer && closeDrawer(); closeProductDetail(); }); await p.waitForTimeout(500);
    // card: the colour select changes the card photo
    const cardSrc2 = await E(() => {
      const sel = [...document.querySelectorAll('.card .variant-select')].find(s => s.closest('.card').querySelector('.card-photo'));
      const card = sel.closest('.card'), pid = +card.querySelector('.card-photo').dataset.pid, q = products.find(x => x.id === pid);
      q.images = ['https://x.test/ph9001.jpg', 'https://x.test/ph9002.jpg']; q.thumbs = q.images.slice(); q.variants = q.variants.map((v, i) => ({ ...v, img: i === 1 ? 1 : null }));
      sel.value = q.variants[1].name; onVariantChange(pid, sel);
      return pid;
    }).then(async pid => { await p.waitForTimeout(800); return E(pid => document.querySelector(`.card-photo[data-pid="${pid}"]`).getAttribute('src'), pid); });
    ok(/ph9002/.test(cardSrc2), `${w}: card colour select shows photo #2 (${(cardSrc2.match(/ph\d+/) || [])[0]})`);
    ok(errs.length === 0, `${w}: no page errors ${JSON.stringify(errs.slice(0, 2))}`);
    // admin form
    await E(() => { document.getElementById('adminPage').classList.add('open'); switchAdminTab('products'); });
    await E(([imgs, v]) => { adminAddProductBtn.click(); adminProdImage.value = imgs; adminProdVariants.value = v; renderAdminProdImagePreview(); admFormSync('ویرایش: تست'); }, [P.image_url, P.variants]);
    await p.waitForTimeout(300);
    const on = () => E(() => [...document.querySelectorAll('#apfVars .apf-var')].map(r => r.querySelector('[data-k=name]').value + '=' + (r.querySelector('.apf-var-pic.on b')?.textContent || '-')).join(','));
    ok(await on() === 'طلایی=۳,نقره‌ای=۲,رزگلد=-,برنزی=۱', `${w}: admin shows each colour's photo: ${await on()}`);
    await E(() => document.querySelectorAll('#apfVars .apf-var')[2].querySelectorAll('.apf-var-pic')[0].click());
    ok(await E(() => adminProdVariants.value) === 'طلایی:3::3,نقره‌ای:2::2,رزگلد:::1,برنزی:0::1', 'admin: linking رزگلد to photo 1 saves rزگلد:::1: ' + await E(() => adminProdVariants.value));
    await E(() => moveAdminProdImage(2, 0)); // photo 3 becomes the cover: 3->1, 1->2, 2->3
    ok(await on() === 'طلایی=۱,نقره‌ای=۳,رزگلد=۲,برنزی=۲', `${w}: moving photo 3 to the front keeps the links: ${await on()}`);
    await E(() => removeAdminProdImage(1)); // delete (old photo 1, now #2): its colours lose the link, #3 -> #2
    ok(await on() === 'طلایی=۱,نقره‌ای=۲,رزگلد=-,برنزی=-', `${w}: deleting a photo unlinks its colours: ${await on()}`);
    ok(await E(() => adminProdVariants.value) === 'طلایی:3::1,نقره‌ای:2::2,رزگلد,برنزی:0', 'admin: variants after delete: ' + await E(() => adminProdVariants.value));
    await E(() => document.querySelectorAll('#apfVars .apf-var')[0].querySelector('.apf-var-pic.on').click());
    ok((await E(() => adminProdVariants.value)).startsWith('طلایی:3,'), `${w}: tapping the chosen photo again unlinks it`);
    const wide = await E(() => [...document.querySelectorAll('#adminPage .apf-var *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).length);
    ok(wide === 0, `${w}: photo pickers fit the screen`);
    await p.screenshot({ path: `/tmp/claude-0/-home-user-danialsaffarian-github-io/4f754ebc-1cc0-50fe-b6cf-dd9b3d9b87d4/scratchpad/colorpic_admin_${w}.png`, clip: await E(() => { const r = document.getElementById('apfVars').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 60), width: innerWidth, height: Math.min(700, r.height + 120) }; }).then(c => ({ ...c })), fullPage: true });
    await p.close();
  }
  await b.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
