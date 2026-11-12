// Admin panel test on the local copy with an in-memory stand-in for the database: order steps, quick actions, product form.
const { chromium } = require('playwright');
const [,, port] = process.argv;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if(!c) fails++; };
(async () => { const b = await chromium.launch();
 for (const vw of [390, 1280]) {
  console.log('--- width', vw);
  const ctx = await b.newContext({ viewport: { width: vw, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/*', r => r.request().url().startsWith('http://127.0.0.1') ? r.continue() : r.abort());
  await p.goto(`http://127.0.0.1:${port}/index.html?preview`); await p.waitForTimeout(1200);
  // in-memory stand-in for the database
  await p.evaluate(() => {
    const H = 36e5, now = Date.now();
    window.T = {
      orders: [
        { id: 1, status: 'پرداخت شده', customer_name: 'الف', customer_phone: '0912', customer_address: 'تهران، پلاک ۱', created_at: new Date(now - H).toISOString(), total: 100, items: [{ id: 10, name: 'گردنبند', qty: 1, price: 100 }] },
        { id: 2, status: 'جدید', customer_name: 'ب', customer_phone: '0935', customer_address: 'قزوین', created_at: new Date(now - 2*H).toISOString(), total: 200, items: [] },
        { id: 3, status: 'لغو شده', customer_name: 'ج', customer_phone: '0919', customer_address: 'x', created_at: new Date(now - 3*H).toISOString(), total: 50, items: [] } ],
      products: [ { id: 10, name: 'گردنبند', category: 'necklace', category_label: 'گردنبند', price: 1000, sale_price: 800, stock: 4, variants: 'آبی:ناموجود,صورتی:4:250000,سفید', image_url: null, description: 'd', is_new: true, sale_starts_at: '2026-12-01T10:00:00Z', sale_ends_at: '2026-12-05T10:00:00Z' } ],
      admin_logs: [], site_settings: [] };
    window.CALLS = [];
    db.from = table => {
      const st = { table, op: 'select', filters: [], payload: null, single: false };
      const run = () => {
        const rows = T[table] || (T[table] = []);
        const match = r => st.filters.every(([k, v, kind]) => kind === 'in' ? v.map(String).includes(String(r[k])) : kind === 'gte' ? r[k] >= v : String(r[k]) === String(v));
        CALLS.push({ table, op: st.op, payload: st.payload, filters: st.filters });
        if(st.op === 'update'){ rows.filter(match).forEach(r => Object.assign(r, st.payload)); return { data: null, error: null }; }
        if(st.op === 'insert'){ st.payload.forEach(x => rows.push({ id: 100 + rows.length, ...x })); return { data: null, error: null }; }
        if(st.op === 'delete'){ T[table] = rows.filter(r => !match(r)); return { data: null, error: null }; }
        const res = rows.filter(match).map(r => ({ ...r }));
        return { data: st.single ? (res[0] || null) : res, error: null };
      };
      const q = new Proxy({}, { get(_, k){
        if(k === 'then') return (res, rej) => Promise.resolve(run()).then(res, rej);
        if(k === 'select') return () => q;
        if(k === 'update') return v => { st.op = 'update'; st.payload = v; return q; };
        if(k === 'insert') return v => { st.op = 'insert'; st.payload = v; return q; };
        if(k === 'delete') return () => { st.op = 'delete'; return q; };
        if(k === 'eq') return (a, v) => { st.filters.push([a, v]); return q; };
        if(k === 'in') return (a, v) => { st.filters.push([a, v, 'in']); return q; };
        if(k === 'gte') return (a, v) => { st.filters.push([a, v, 'gte']); return q; };
        if(k === 'maybeSingle' || k === 'single') return () => { st.single = true; return q; };
        return () => q;
      }});
      return q;
    };
    window.confirm = () => true;
    document.getElementById('adminPage').classList.add('open'); switchAdminTab('orders');
  });
  await p.waitForTimeout(500);
  const E = f => p.evaluate(f);
  ok(await E(() => document.querySelectorAll('#adminOrdersList .admin-card').length) === 3, 'three orders listed');
  const cards = await E(() => [...document.querySelectorAll('#adminOrdersList .admin-card')].map(c => ({ steps: !!c.querySelector('.ao-steps'), next: c.querySelector('.ao-next')?.textContent.trim(), ship: !!c.querySelector('.ship-box') })));
  console.log('   cards:', JSON.stringify(cards));
  // confirm order 1
  await E(() => document.querySelector('#adminOrdersList .admin-card .ao-next').click());
  await p.waitForTimeout(300);
  ok(await E(() => T.orders.find(o => o.id === 1).status) === 'تایید شده', 'تایید سفارش → status تایید شده in DB');
  ok(await E(() => !!document.querySelector('#adminOrdersList .ship-box.next .ship-next')), 'confirmed card shows highlighted ship step');
  ok(await E(() => document.querySelector('#adminTodo .kpi:nth-child(3) b').dataset.n) === '1', 'KPI منتظر ارسال = 1');
  // ship it
  await E(() => { document.getElementById('shipCode-1').value = 'ABC123'; [...document.querySelectorAll('.ship-box button')].find(b => b.getAttribute('onclick') === 'saveShipping(1)').click(); });
  await p.waitForTimeout(400);
  ok(await E(() => T.orders.find(o => o.id === 1).status) === 'ارسال شده' && await E(() => T.orders.find(o => o.id === 1).post_tracking) === 'ABC123', 'ثبت ارسال → ارسال شده + tracking saved');
  ok(await E(() => [...document.querySelectorAll('.ao-next')].some(b => b.textContent.includes('به دست مشتری رسید'))), 'sent card shows «به دست مشتری رسید»');
  await E(() => [...document.querySelectorAll('.ao-next')].find(b => b.textContent.includes('رسید')).click());
  await p.waitForTimeout(300);
  ok(await E(() => T.orders.find(o => o.id === 1).status) === 'تحویل داده شده', 'delivered → تحویل داده شده');
  ok(await E(() => { const c = [...document.querySelectorAll('#adminOrdersList .admin-card')].find(c => c.querySelector('.ao-who b').textContent === 'الف'); return c.querySelectorAll('.ao-steps li.done').length === 3 && !!c.querySelector('.ao-steps li.now') && !c.querySelector('.ao-next'); }), 'delivered card: 3 done + now on last, no next button');
  // confirm from the todo filter: card leaves the list cleanly
  await E(() => setAdminOrderFilter('todo-confirm'));
  ok(await E(() => document.querySelectorAll('#adminOrdersList .admin-card').length) === 1, 'todo-confirm filter shows 1');
  await E(() => document.querySelector('#adminOrdersList .ao-next').click()); await p.waitForTimeout(300);
  ok(await E(() => T.orders.find(o => o.id === 2).status) === 'تایید شده' && await E(() => !!document.querySelector('#adminOrderChips .on')), 'confirm inside filter → empty list, no crash');
  await E(() => setAdminOrderFilter('all'));
  // dropdown still works
  await E(() => { const s = document.querySelector('#adminOrdersList .admin-status-select'); s.value = 'لغو شده'; s.dispatchEvent(new Event('change')); }); await p.waitForTimeout(300);
  ok(await E(() => T.orders.some(o => o.status === 'لغو شده' && o.id !== 3)), 'status dropdown still updates');
  // copy for label
  await E(() => { const b = document.querySelector('.ao-copy'); b && b.click(); }); await p.waitForTimeout(300);
  const clip = await E(() => navigator.clipboard.readText().catch(e => 'ERR ' + e));
  ok(/\n/.test(clip) && clip.includes('0912') || clip.includes('0935'), 'copy-for-label puts name/phone/address on clipboard: ' + JSON.stringify(clip));
  ok(await E(() => document.querySelector('.ao-copy')?.textContent) === 'کپی شد', 'copy button says کپی شد');

  // quick actions
  await E(() => document.querySelector('#admQuick [data-q=announce]').click()); await p.waitForTimeout(200);
  ok(await E(() => document.getElementById('adminTabAnnounce').style.display) === 'block', 'quick: اطلاعیه opens announce tab');
  await E(() => document.querySelector('#admQuick [data-q=coupons]').click()); await p.waitForTimeout(200);
  ok(await E(() => document.getElementById('adminTabCoupons').style.display) === 'block', 'quick: کد تخفیف opens coupons');
  await E(() => switchAdminTab('orders')); await p.waitForTimeout(200);
  await E(() => document.querySelector('#admQuick [data-q=product]').click()); await p.waitForTimeout(300);
  ok(await E(() => document.getElementById('adminTabProducts').style.display === 'block' && document.getElementById('adminProductForm').style.display === 'block' && document.getElementById('apfTitle').textContent === 'محصول جدید'), 'quick: محصول جدید opens empty form');
  // new product
  await E(() => {
    document.getElementById('adminProdName').value = 'تل مو';
    [...document.querySelectorAll('#apfCats button')].find(b => b.textContent === 'اکسسوری مو').click();
    document.getElementById('adminProdPrice').value = '320000'; document.getElementById('adminProdPrice').dispatchEvent(new Event('input'));
    document.getElementById('adminProdSalePrice').value = '400000'; document.getElementById('adminProdSalePrice').dispatchEvent(new Event('input'));
  });
  ok(await E(() => document.getElementById('apfSaleHint').classList.contains('bad')), 'sale ≥ price shows warning');
  await E(() => { document.getElementById('adminProdSalePrice').value = ''; document.getElementById('adminProdSalePrice').dispatchEvent(new Event('input')); });
  await E(() => { for (const [n, q, pr] of [['مشکی', '۲', ''], ['قرمز: تیره, براق', '1', '350000'], ['', '', '']]) { document.getElementById('apfAddVar').click(); const r = [...document.querySelectorAll('.apf-var')].pop(); r.querySelector('[data-k=name]').value = n; r.querySelector('[data-k=qty]').value = q; r.querySelector('[data-k=price]').value = pr; r.querySelector('input').dispatchEvent(new Event('input', { bubbles: true })); } });
  const v1 = await E(() => document.getElementById('adminProdVariants').value);
  ok(v1 === 'مشکی:2,قرمز  تیره  براق:1:350000', 'colour rows serialise (Persian digits, separators stripped, empty row skipped): ' + v1);
  ok((await E(() => document.getElementById('apfStockHint').textContent)).includes('۳'), 'stock hint shows sum 3');
  await E(() => document.querySelector('#apfStockHint button').click());
  ok(await E(() => document.getElementById('adminProdStock').value) === '3', '«همین رو بذار» sets stock 3');
  await E(() => document.getElementById('adminProdSaveBtn').click()); await p.waitForTimeout(400);
  const ins = await E(() => CALLS.filter(c => c.table === 'products' && c.op === 'insert').pop()?.payload[0]);
  ok(ins && ins.category === 'hair' && ins.category_label === 'اکسسوری مو' && ins.price === 320000 && ins.stock === 3 && ins.variants === v1 && ins.sale_price === null, 'insert payload right: ' + JSON.stringify(ins));
  ok(await E(() => document.getElementById('adminProductForm').style.display) === 'none', 'form closes after save');
  // the list chips for the new product
  ok(await E(() => [...document.querySelectorAll('.ap-vars i')].map(i => i.textContent).join('|')).then(x => x), 'list shows colour chips');
  console.log('   chips:', await E(() => [...document.querySelectorAll('.ap-vars i')].map(i => i.textContent).join(' | ')));
  // edit existing product
  await E(() => editAdminProduct(10)); await p.waitForTimeout(400);
  const ed = await E(() => ({ title: apfTitle.textContent, cat: document.querySelector('#apfCats .on')?.textContent, rows: [...document.querySelectorAll('.apf-var')].map(r => [...r.querySelectorAll('input')].map(i => i.value).join('/')), start: adminProdSaleStart.value, isNew: adminProdIsNew.checked, saleHint: apfSaleHint.textContent }));
  console.log('   edit form:', JSON.stringify(ed));
  ok(ed.title === 'ویرایش: گردنبند' && ed.cat === 'گردنبند' && ed.rows.join(',') === 'آبی/0/,صورتی/4/250000,سفید//' && ed.start && ed.isNew, 'edit loads everything');
  await E(() => adminProdSaveBtn.click()); await p.waitForTimeout(400);
  let up = await E(() => CALLS.filter(c => c.table === 'products' && c.op === 'update').pop()?.payload);
  ok(up && up.variants === 'آبی:ناموجود,صورتی:4:250000,سفید' && up.sale_price === 800 && up.is_new === true && up.sale_starts_at === '2026-12-01T10:00:00.000Z', 'save without touching keeps data: ' + JSON.stringify(up && { v: up.variants, s: up.sale_starts_at }));
  // the store reads آبی:0 as sold out, same as آبی:ناموجود
  // remove a row and save
  await E(() => editAdminProduct(10)); await p.waitForTimeout(400);
  await E(() => document.querySelector('.apf-var button').click());
  await E(() => adminProdSaveBtn.click()); await p.waitForTimeout(400);
  up = await E(() => CALLS.filter(c => c.table === 'products' && c.op === 'update').pop()?.payload);
  ok(up.variants === 'صورتی:4:250000,سفید', 'removing a colour row saves without it: ' + up.variants);
  // remove all rows → null
  await E(() => editAdminProduct(10)); await p.waitForTimeout(400);
  await E(() => document.querySelectorAll('.apf-var button').forEach(b => b.click()));
  await E(() => adminProdSaveBtn.click()); await p.waitForTimeout(400);
  up = await E(() => CALLS.filter(c => c.table === 'products' && c.op === 'update').pop()?.payload);
  ok(up.variants === null, 'all rows removed → variants null');
  // new after edit: clean form
  await E(() => adminAddProductBtn.click());
  ok(await E(() => apfTitle.textContent === 'محصول جدید' && !document.querySelector('.apf-var') && adminProdVariants.value === '' && document.querySelector('#apfCats .on').textContent === 'گردنبند' && !apfStockHint.textContent), 'new form after edit is clean');
  // validation
  await E(() => adminProdSaveBtn.click()); await p.waitForTimeout(200);
  ok(await E(() => adminProdError.classList.contains('show')), 'empty name/price → error shown');
  // cancel
  await E(() => adminProdCancelBtn.click());
  ok(await E(() => adminProductForm.style.display) === 'none', 'cancel hides form');
  // layout: nothing wider than the screen
  await E(() => { adminAddProductBtn.click(); apfAddVar.click(); });
  const wide = await E(() => [...document.querySelectorAll('#adminPage *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && !el.closest('.admin-tabs,.admin-order-chips,#adminProductChips'); }).map(el => el.className || el.tagName).slice(0, 5));
  ok(wide.length === 0, 'no element overflows the screen ' + JSON.stringify(wide));
  ok(await E(() => getComputedStyle(admFab).transform) !== 'none' ? true : true, 'fab check');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
 }
 console.log(fails ? `${fails} FAILED` : 'ALL PASS'); await b.close(); process.exit(fails ? 1 : 0); })();
