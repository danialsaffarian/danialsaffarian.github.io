# Site health check

A routine pass over the shop, run by Claude on a schedule. Nothing here needs secrets.

## 1. Live site (through the database's outbound HTTP, since the session itself cannot reach the domain)

Send, then read the answers a few seconds later (Supabase project `goykyskctygnciwttfqj`):

```sql
select net.http_get('https://hanagalleryy.ir/') home, net.http_get('https://hanagalleryy.ir/assets/app.js') js,
       net.http_get('https://hanagalleryy.ir/assets/site.css') css, net.http_get('https://hanagalleryy.ir/c/necklace/') cat,
       net.http_get('https://hanagalleryy.ir/terms/') terms, net.http_get('https://api.hanagalleryy.ir/__relay/health') relay,
       net.http_get('https://api.hanagalleryy.ir/functions/v1/geo') geo,
       net.http_post(url := 'https://goykyskctygnciwttfqj.supabase.co/functions/v1/payment',
                     body := '{"action":"verify","trackId":1}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb) pay;

select id, status_code, timed_out, error_msg, length(content::text) len,
       (select h.value from jsonb_each_text(headers) h where lower(h.key) = 'content-type' limit 1) ctype,
       substring(content::text from 'assets/app\.js\?v=[0-9a-f]+') appver, left(content::text, 60) head
from net._http_response where id in (/* the ids above */) order by id;
```

Healthy: every row 200; html/js/css content types right; `appver` equals the one in `index.html` on `main`
(a mismatch for more than a few minutes means deploys are not reaching the site); relay says `ok`;
geo returns `{"iran":...}`; payment returns `{"status":"unknown"}`.

## 2. Orders and payments

```sql
select count(*) filter (where o.status = 'در انتظار پرداخت' and o.created_at < now() - interval '10 minutes'
                        and not exists (select 1 from payment_attempts a where a.order_id = o.id)) never_reached_gateway,
       count(*) filter (where o.payment_status = 'paid') paid, count(*) total
from orders o where o.created_at > now() - interval '6 hours';
```

`never_reached_gateway` above zero while payment mode is live means customers are being turned away before Zibal:
read the `payment` function's logs for the reason (403 = the VPN check, 502 = Zibal, 500 = our bug).

## 3. Function errors in the logs (last 6 hours)

```sql
select event_message, count(*) n from logs
where source = 'function_edge_logs' and toInt32OrZero(log_attributes['response.status_code']) >= 400
group by event_message order by n desc limit 30
```

A few 401s (logged-out visitors) are normal. Repeated 403/5xx on `payment`, `notify-order`, `send-sms-hook` or `site` are not.

## 4. Browser checks on the working copy

```bash
git fetch origin main && git merge origin/main   # never reset the branch: it may hold a test the owner has not published yet
tools/monitor/run.sh        # prints only failures; exit 0 = all passed
```

`store.js` covers layout at four widths, the category filter, add to cart, the product page and the cart drawer;
`admin.js` covers order steps, the payment health card, quick actions and the product form against an in-memory database.

If the branch is ahead of `main`, those commits are a test waiting for the owner's «منتشر کن»: check them, do not publish them.

## SMS alerts to the owner (runs by itself)

The `health-alert` edge function runs every 10 minutes (`cron.job` `hg-health-alert`) and texts the owner's
numbers when an order never reached the payment gateway, or when the site, the relay or the payment function
fail three checks in a row. One text per problem, at most six a day. It sends through the approved
"new order" SMS template with the alert in the name field (plain-text messages wait for the provider's
manual approval, so they are no use for alerts); `health_state.sms_mode` switches between `pattern` and `simple`.
What it sent is in `health_alerts` (`kind = 'sent'`), probe counters are in `health_state` (`probe-*`).
