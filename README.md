# Pop Art Mixer

Press **Random** until the colours look good, then press **Save**. No thinking required.

One self-contained page (`index.html`): open it in a browser, or serve the repo root with GitHub Pages.

## What it does

- **Text**: two big lines plus a small line (`ART / is part of / MARKETING`). Put `|` between options in the small line (`is part of | is`) and each tile picks one. Turn on "swap" and every other tile flips the big lines, so you get "ART IS MARKETING" next to "MARKETING IS ART".
- **Image**: upload, drop or paste a picture. It's flattened to three tones (shadow, middle, highlight), and each tile paints those tones in its own colours. The Detail slider sets how blobby or sharp it gets.
- **QR code**: enter a link and an optional caption. QR tiles only use a darker code on a lighter colour with a contrast ratio of at least 4:1, so they stay scannable.
- **Palette**: All, Warhol (hot screen-print colours), Riso (risograph-style inks on off-white paper), Neon.
- **Tiles**: 2×2 or 3×3 tiles per artwork. **Texture**: none, film grain, or Ben-Day dots.
- **Compare**: show 1, 2×2, 3×3, 4×4 or 5×5 artworks at once (slider, or keys `1`–`5`). Tiles and Compare are independent, so nine 2×2 artworks or four 3×3 ones both work. Click the best artwork to keep working on it. **Back** returns to the wall. Saving while the wall is showing saves the whole wall as one poster.
- **On the wall**, hover an artwork for its own toolbar: **re-roll** just that one, **lock** it (Random keeps it), **zoom** in, **edit** it (opens it on its own, where you can re-roll single tiles), or **Buy**. Clicking an artwork zooms in; the zoom view has Buy now, Edit, Re-roll, Lock and Save, and ← → browse the wall. On small artworks (5×5 walls, phones) the toolbar hides and a tap zooms in.
- **Buy now** (main bar) buys the current artwork, or the whole wall as one print while the wall is showing. See [Shop](#shop).
- **Locks**: hover a tile and click the lock. Random (and every artwork on the wall) keeps locked tiles.
- **Taste**: every picked or saved artwork records its background/text colour pairs, and Random favours those pairs (weight 1 + 3·√count, so nothing ever gets ruled out). Saved walls don't count. Untick "Favour colour pairs" to roll purely at random.

## Controls

| Action | Button | Key |
|---|---|---|
| New colours for every tile | Random | `Space` |
| New colours for one tile | click the tile | |
| Keep a tile | lock icon on the tile | |
| Wall of artworks to compare | Compare slider | `1`–`5` |
| Undo the last roll | Back | `Z` |
| Download a PNG (about 1800×1800) | Save | `S` |

Files are named `popart-marsita-<timestamp>.png`, using an ISO 8601 basic-format UTC timestamp such as `20261106T143005Z`. That form has no colons, because Windows rejects them in filenames.

Saved images also appear in "Your picks" under the grid for the current tab only.

## Shop

Buy opens a checkout: pick a size, see the price and a to-scale room view (the print above a 160 cm sideboard), place the order. The order is saved first; payment is only offered after that, so nobody pays for an order the shop never received. A confirmation then shows the reference (like `PM-7K3F2Q`), size, total and status, and the buyer can reopen it from **Orders** in the header.

Settings live in `SHOP` near the top of the script in `index.html`:

| Setting | What it does |
|---|---|
| `currencies`, `sizes[].prices` | Prices per currency (EUR, GBP, USD). **Placeholders**; with the order server, `worker/shop.js` sets the real ones. |
| `sizes[].payLink` | A [Stripe Payment Link](https://docs.stripe.com/payment-links) per size. Empty = Buy **reserves** the print, asks for an email and charges nothing. |
| `api` | Where the order server lives (default `/api`, the same site). If a server answers there with card payment on, its sizes and prices replace the ones in `SHOP` and Buy goes to Stripe Checkout. See **Selling with Cloudflare and Stripe** below. |

**With Payment Links**, the page opens `payLink?client_reference_id=<order reference>`. Stripe attaches that reference to the payment (Dashboard and the `checkout.session.completed` webhook), so each payment maps to one saved order.

**Stripe keys.** A Payment Link needs no key. A secret key (`sk_...`) must never go in `index.html`, this repo or a chat: anyone who opens the page could read it and move money. It belongs on the server as a secret (see below).

**What an order contains**: reference, size, price, status, email (reservations only), a thumbnail, and the recipe (mode, palette, grid, texture, every tile's colours, the text or QR link). In Image mode it also stores the small square crop the artwork is drawn from, so the print can be remade without the original photo.

**Where orders are stored**

- As a claude.ai artifact: `orders/<viewer id>/items/<reference>` in the artifact's database. Each buyer also gets a marker document at `orders/<viewer id>`, so the owner can list the `orders` collection to find buyers, then read each buyer's `items`. Only the artifact owner and editors can read all orders; each buyer reads and writes only their own. Because buyers can write their own order, never treat its `status` field as proof of payment. Stripe is the record of who paid.
- On claude.ai, people outside your organisation can open a shared artifact but cannot write to its database, so they cannot order. Selling to the public needs the order server.
- With the order server: in Cloudflare KV (see below).
- Opened as a plain file, or on GitHub Pages without Payment Links, Buy only offers the PNG.

Without the order server, the page cannot see whether a Stripe payment succeeded. Statuses the page understands, for whoever updates orders by hand: `reserved`, `awaiting_payment`, `paid`, `printing`, `shipped`, `cancelled`.

## Selling with Cloudflare and Stripe

`worker/index.js` is a small order server that runs as a [Cloudflare Worker](https://developers.cloudflare.com/workers/). One deploy serves the page **and** the shop, on the same address, so there is nothing to host at home and no CORS to set up.

**How a sale goes**

1. Buy → **Continue to payment**. The page sends the artwork (thumbnail, recipe, photo crop in Image mode) and the size. The server ignores any price from the browser: it takes the price from `worker/shop.js`, saves the order, opens a Stripe Checkout Session and replies with its address.
2. The buyer pays on Stripe's page. Stripe collects the email and delivery address and emails the receipt.
3. Stripe sends the buyer back to `/?order=PM-XXXXXX&paid=1`. The page asks the server, the server asks Stripe directly, and the buyer sees **Paid. Thank you!**
4. Separately, Stripe's webhook tells the server the order is paid, even if the buyer closed the tab. Paid orders are kept; unpaid ones are deleted after 7 days.
5. A buyer who cancels sees **One step left: pay**. The link is refreshed if Stripe's 24-hour checkout link has run out.

The buyer's browser remembers their orders (reference plus a private order key), so **Orders** in the header lists them and shows the latest status.

**Setup** (once; needs Node.js and free Cloudflare and Stripe accounts)

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler kv namespace create ORDERS
```

Paste the `id` it prints into `wrangler.jsonc` (replacing `REPLACE_WITH_KV_NAMESPACE_ID`). Then set prices in `worker/shop.js` and add the secrets. Each command asks you to paste the value, so it never lands in a file or your shell history. Use your Stripe secret key (`sk_live_...`, or a test key `sk_test_...` if you prefer Stripe's test mode):

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

```bash
npx wrangler secret put ADMIN_TOKEN
```

(`ADMIN_TOKEN`: any random string of 20+ characters, for example from `openssl rand -hex 24`.)

```bash
npx wrangler deploy
```

It prints the address, like `https://popart-mixer.<you>.workers.dev`. Then in the Stripe Dashboard (test mode): **Developers → Webhooks → Add endpoint**, URL `https://<your address>/api/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. Copy its signing secret (`whsec_...`):

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

**Testing in live mode**: open the site with `?test=1` at the end of the address (`https://<your address>/?test=1`). A hidden **Test order** size appears, priced €1 / £1 / $1. Buy it with your own card: it is a real payment that checks the whole flow, and the order is marked `test` so it is never printed. Refund it in the Stripe Dashboard afterwards if you like. (In Stripe's test mode, use card `4242 4242 4242 4242` instead.)

**Currency**: the page guesses from the visitor's country (UK → £, US/Canada/Australia/NZ → $, everyone else → €) and shows a picker in the top right. A visitor's choice is remembered in their browser. The table is `countryCurrency` in `worker/shop.js`. Delivery countries are `countries` there: check your printer ships to all of them.

**Going live**: switch the Stripe Dashboard to live mode, add the same webhook there, and replace both Stripe secrets with the live ones. Instead of the full secret key you can use a *restricted key* (`rk_live_...`) that can only write Checkout Sessions; if Stripe refuses a request, the error names the permission it is missing.

**Your own domain**: if the domain's DNS is on Cloudflare, add it under the Worker's **Settings → Domains & Routes**. Then change the four link-preview lines in `<head>` of `index.html` to that address.

**Running orders** (statuses: `awaiting_payment`, `paid`, `printing`, `shipped`, `cancelled`, `refunded`)

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your address>/api/admin/orders?status=paid
```

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your address>/api/admin/order/PM-XXXXXX
```

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d '{"status":"shipped","tracking":"RM123456789GB"}' https://<your address>/api/admin/order/PM-XXXXXX
```

The full order includes the delivery address, email, recipe, thumbnail and (Image mode) the photo crop. The buyer sees the new status and tracking number under **Orders**. Refunds are done in the Stripe Dashboard; then set the status to `refunded`.

**Local testing**: put test secrets in a `.dev.vars` file (git-ignored), one `NAME=value` per line, then run `npx wrangler dev`. To receive webhooks locally, use the Stripe CLI: `stripe listen --forward-to localhost:8787/api/stripe/webhook`. Server tests with a fake Stripe: `npm test`.

**Limits to know**

- Cloudflare's free plan covers a small shop (100,000 requests a day and 1,000 KV writes a day at the time of writing; an order uses 3–6 writes). Check current limits on Cloudflare's pricing page.
- The order endpoint is open to anyone, like any shop's basket. Unpaid orders expire after 7 days, which caps the junk someone could store. If spam becomes a problem, add Cloudflare Turnstile or a rate-limiting rule.
- Print files: orders store a thumbnail and the recipe, not a print-resolution image. Rendering print files from the recipe is the next build.
- `.assetsignore` keeps the server code, config and README from being served as public files.

## Favicon and link preview

- `favicon.svg` (also inlined in `index.html`), `apple-touch-icon.png` (180×180) and `preview.png` (1200×630, used by `og:image`).
- Link previews need full addresses. The tags assume `https://marsrobertson.github.io/popart-style/`; change the four lines marked in `<head>` if the page lives elsewhere.

## Where taste data lives

- Opened as a plain file or on GitHub Pages, it stays in that browser (`localStorage`, last 500 choices). Nothing is uploaded.
- Published as a claude.ai artifact, each choice is also stored in the artifact's shared database (`saves` collection: colour pairs, mode, palette, grid, time; no user names). The page reads the latest 1000 to weight Random, so everyone's picks shape everyone's rolls.

## How the colours are picked

Each tile picks a background, then a "big text" colour that works with it. A pair passes if its brightness contrast is at least 2.2:1, **or** if the hues are at least 100° apart on the colour wheel. That second rule is what allows the vibrating low-contrast pop pairs (pink on teal, cyan on orange) and blocks muddy ones (red on violet). The small line goes white or black, whichever reads better on the background. Tiles on screen don't share a background colour.

## Ideas for later

- A public gallery: users submit their best picks and vote.
- Send paid orders to a print-on-demand service, and render print-resolution files from the stored recipe.
- Order emails from the shop (shipped, with tracking), and a small seller page instead of curl.
- Prune or roll up old `saves` rows before the shared store's 25,000-document cap.
