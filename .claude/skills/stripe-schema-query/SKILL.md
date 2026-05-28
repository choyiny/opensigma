---
name: stripe-schema-query
description: Answer free-text analytics questions about Stripe data stored in this project's D1 database (stripe_sync) by generating SQL, running it via wrangler, and returning a results table (plus optional chart). Use this skill whenever the user asks anything analytical or aggregate about Stripe entities — revenue, products, prices, subscriptions, customers, segments, charges, payments, refunds, disputes, payouts, top-N rankings, time-of-purchase patterns, period-over-period comparisons, conversion rates, in-store vs online, MRR/ARR — even if they don't explicitly mention SQL, D1, or the database. Trigger on questions like "which products generate the most revenue", "top 10 products last month", "subscription mix by plan", "what hour of day do customers buy most", "in-store vs online revenue", "churned customers this quarter", "average order value by country".
---

# Stripe schema query

This project mirrors Stripe objects into a Cloudflare D1 database called **`stripe_sync`** (binding `DB`). The Drizzle schema is the source of truth at `src/db/schema.ts` — read it whenever you need exact column names. Columns evolve; do not guess.

## Workflow

1. **Pick the database — ask if unspecified.** Local dev DB and prod DB return different results. If the user hasn't said, ask: *"Local (your dev DB) or remote (production)?"* Default to local if pressed.
2. **Read `src/db/schema.ts`** for the tables involved. JSON columns vs scalar columns matter — see Conventions below.
3. **Translate the question into SQL**, applying the conventions and the business-concept mappings.
4. **Run it** via wrangler (see Running queries).
5. **Render results** as a Markdown table.
6. **Offer a chart** when the answer is naturally visual (rankings, distributions, time series).

## Read-only

Only emit `SELECT` queries. Never `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, or `ATTACH`. If the user asks to mutate data, decline and direct them to a Drizzle migration or `wrangler d1 execute` themselves.

## Stripe data conventions in this schema

These bite if you forget. Apply them in every query.

- **Amounts are integer cents.** Divide by `100.0` when presenting money. Currency is in a separate `currency` column (lowercase ISO).
- **Multi-currency is real.** Don't sum `amount` across rows with different currencies. Either filter to one (`WHERE currency = 'usd'`) or `GROUP BY currency`. If you're unsure, group by currency and report each.
- **Timestamps are unix seconds (integer).** `datetime(created, 'unixepoch')` for readability. `unixepoch('now', '-30 days')` for relative ranges. `strftime('%H', datetime(created, 'unixepoch'))` for hour-of-day, `'%w'` for day-of-week (0=Sun…6=Sat). Times are **UTC** — adjust with `'-5 hours'` etc. if the user wants a local zone.
- **Status matters for revenue.** `charges` rows exist for failed attempts. Real revenue: `charges.status = 'succeeded'` and subtract `amount_refunded`. Paid invoices: `invoices.status = 'paid'`, use `amount_paid`. Completed Checkout: `checkout_sessions.payment_status = 'paid'`. Active subs: `subscriptions.status = 'active'`.
- **JSON columns** (anything `mode: 'json'` in `schema.ts`) need `json_extract(col, '$.path')`. Common paths:
  - Payment channel from a charge: `json_extract(payment_method_details, '$.type')` → `'card'`, `'card_present'`, `'us_bank_account'`, …
  - Card brand: `json_extract(payment_method_details, '$.card.brand')`
  - Customer country: `json_extract(address, '$.country')` on `customers`
  - Invoice line item price: `json_extract(pricing, '$.price_details.price')` on `invoice_line_items` (returns a `price` ID)
  - Subscription recurring interval: `json_extract(recurring, '$.interval')` on `prices`
- **Foreign keys are string IDs, not enforced.** Join on IDs: `subscriptions.customer = customers.id`, `prices.product = products.id`, `invoice_line_items.invoice = invoices.id`, `charges.payment_intent = payment_intents.id`.
- **`livemode`** distinguishes test from live data in the same DB. For "real revenue" filter `livemode = 1`; for test exploration, the opposite.
- **`deleted` flag** exists on `customers`, `coupons`, `tax_ids`. Exclude unless asked: `WHERE deleted IS NOT 1`.
- **`last_event_at`** exists on most tables — it's an internal sync field, not a Stripe field. Don't use it to answer business questions.

## Mapping business concepts → tables

When a phrase maps approximately (no clean Stripe equivalent), **say so out loud** in your reply before showing the SQL. Don't silently substitute.

### Revenue
- **Net one-time payment revenue:** `SUM(amount - amount_refunded)` on `charges` where `status = 'succeeded'`.
- **Paid invoice revenue:** `SUM(amount_paid)` on `invoices` where `status = 'paid'`.
- **Revenue per product:** `charges` don't link to products directly. Use:
  - **Invoiced path:** `invoice_line_items` → `prices` (via `json_extract(pricing, '$.price_details.price')`) → `products`.
  - **Checkout path:** `checkout_session_line_items.price` (a JSON blob containing the price object — extract product via `json_extract(price, '$.product')`).
- **MRR (recurring revenue):** `subscription_items` × `prices` (filter `recurring.interval = 'month'`, scale yearly by `/12`) for `subscriptions.status = 'active'`.

### Customers / segments
"Segment" isn't a Stripe primitive. Common proxies — pick one and name it:
- **Country:** `json_extract(address, '$.country')` on `customers`.
- **Subscribed plan/product:** join via `subscriptions` → `subscription_items` → `prices.product`.
- **Tag in metadata:** `json_extract(metadata, '$.segment')` (or whatever key the user uses).

If "segment" is unqualified, ask the user which they mean.

### In-store vs online
Stripe Terminal transactions surface as `payment_method_details.type = 'card_present'` on `charges`. Everything else (`card`, `link`, `us_bank_account`, …) is online. **Use this as the proxy and say so.**

```sql
SELECT
  CASE WHEN json_extract(payment_method_details, '$.type') = 'card_present'
       THEN 'in_store' ELSE 'online' END AS channel,
  currency,
  SUM(amount - amount_refunded) / 100.0 AS revenue
FROM charges
WHERE status = 'succeeded'
GROUP BY channel, currency;
```

### Time-of-purchase patterns
- Hour of day: `GROUP BY strftime('%H', datetime(created, 'unixepoch'))` on `charges`.
- Day of week: `'%w'` (0=Sun … 6=Sat).
- Month/year: `'%Y-%m'`, `'%Y'`.

### Refunds / disputes
- Refund rate: `SUM(amount_refunded) / SUM(amount)` on `charges` (succeeded).
- Dispute rate: count `disputes` / count `charges` over the same window.
- Chargeback losses: `SUM(amount)` on `disputes` where `status IN ('lost', 'charge_refunded')`.

### Top-N
Almost every question reduces to `ORDER BY <metric> DESC LIMIT N`. Default `LIMIT 10` for "top" questions, `LIMIT 20` for general listings.

## Worked examples

**Q: Which products generate the most revenue?**
```sql
SELECT p.name, p.id, inv.currency, SUM(ili.amount) / 100.0 AS revenue
FROM invoice_line_items ili
JOIN invoices inv ON inv.id = ili.invoice
JOIN prices pr ON pr.id = json_extract(ili.pricing, '$.price_details.price')
JOIN products p ON p.id = pr.product
WHERE inv.status = 'paid'
GROUP BY p.id, inv.currency
ORDER BY revenue DESC
LIMIT 20;
```

**Q: Top 10 products last month**
```sql
SELECT p.name, SUM(ili.amount) / 100.0 AS revenue
FROM invoice_line_items ili
JOIN invoices inv ON inv.id = ili.invoice
JOIN prices pr ON pr.id = json_extract(ili.pricing, '$.price_details.price')
JOIN products p ON p.id = pr.product
WHERE inv.status = 'paid'
  AND inv.created >= unixepoch('now', 'start of month', '-1 month')
  AND inv.created <  unixepoch('now', 'start of month')
GROUP BY p.id
ORDER BY revenue DESC
LIMIT 10;
```

**Q: What hour of day do customers buy most?**
```sql
SELECT strftime('%H', datetime(created, 'unixepoch')) AS hour_utc,
       COUNT(*) AS purchases,
       SUM(amount) / 100.0 AS volume
FROM charges
WHERE status = 'succeeded'
GROUP BY hour_utc
ORDER BY hour_utc;
```

**Q: Most popular subscription plans**
```sql
SELECT p.name AS product, pr.id AS price_id, pr.nickname,
       json_extract(pr.recurring, '$.interval') AS interval,
       COUNT(si.id) AS active_subscribers
FROM subscription_items si
JOIN subscriptions s ON s.id = si.subscription
JOIN prices pr ON pr.id = si.price
JOIN products p ON p.id = pr.product
WHERE s.status = 'active'
GROUP BY pr.id
ORDER BY active_subscribers DESC
LIMIT 20;
```

## Running queries

```bash
# Local dev DB (Miniflare SQLite)
bunx wrangler d1 execute stripe_sync --local --json --command "SELECT …"

# Production
bunx wrangler d1 execute stripe_sync --remote --json --command "SELECT …"
```

- `--json` makes output parseable for formatting and charting. Without it you get a pretty ASCII table.
- For multi-line queries, write to `/tmp/query.sql` and use `--file /tmp/query.sql` (cleaner than escaping a long string).
- Quote shell-sensitive characters carefully when using `--command`.

### When queries fail
- **"no such table"** → table not backloaded yet, or wrong DB target. Confirm `--local` vs `--remote` with the user.
- **"no such column"** → you guessed a name. Re-read `src/db/schema.ts` for that table.
- **JSON path returns NULL** → verify path against a real row: `SELECT pricing FROM invoice_line_items LIMIT 1`. Stripe object shapes vary by Stripe API version.
- **Empty result with no error** → check `livemode`, `status`, and the time window. Often the data is there but filtered out.

## Output format

Reply with:

1. **Approach** (1–3 sentences): which tables and why. **If you're using an approximation** (e.g., proxying "segment" by country, or "in-store" by `card_present`), state it here plainly so the user can correct you.
2. **SQL** in a `sql` code block.
3. **Results** as a Markdown table — top ~20 rows; note if truncated. Format money as `$1,234.56` (or appropriate symbol) and timestamps as `YYYY-MM-DD HH:MM UTC`.
4. **Offer a chart** when it would help: *"Want a bar chart of these?"* — bar for rankings, line for time series, doughnut for share-of-total.

## Charts (on request)

Write a standalone HTML file using Chart.js via CDN, save to `/tmp/chart-<topic>.html`, and `open` it. Skeleton:

```html
<!doctype html><html><body style="font-family:system-ui;padding:24px">
<h2>__TITLE__</h2>
<canvas id="c" width="900" height="500"></canvas>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
new Chart(document.getElementById('c'), {
  type: 'bar',
  data: { labels: __LABELS__, datasets: [{ label: '__SERIES__', data: __VALUES__ }] },
  options: { plugins: { legend: { display: false } } }
});
</script></body></html>
```

Pick a chart type that matches the question:
- **Bar** — top-N rankings, category comparisons (in-store vs online).
- **Line** — time series (revenue by day/month).
- **Doughnut** — share-of-total when there are few categories.
- **Horizontal bar** — long category names (e.g., product names).
