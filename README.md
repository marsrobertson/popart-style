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

Buy opens a checkout: pick a size, see the price, place the order. The order is saved first; payment is only offered after that, so nobody pays for an order the shop never received. A confirmation then shows the reference (like `PM-7K3F2Q`), size, total and status, and the buyer can reopen it from **Orders** in the header.

Settings live in `SHOP` near the top of the script in `index.html`:

| Setting | What it does |
|---|---|
| `currency`, `sizes[].price` | **Placeholders** (GBP 45 / 75 / 120). Set your own. |
| `sizes[].payLink` | A [Stripe Payment Link](https://docs.stripe.com/payment-links) per size. Empty = Buy **reserves** the print, asks for an email and charges nothing. |
| `orderEndpoint` | For a self-hosted copy with its own server. The page POSTs the order as JSON; if the reply is `{"url": "https://..."}` the buyer is sent there to pay. |

**With Payment Links**, the page opens `payLink?client_reference_id=<order reference>`. Stripe attaches that reference to the payment (Dashboard and the `checkout.session.completed` webhook), so each payment maps to one saved order.

**Stripe keys.** A Payment Link needs no key. A secret key (`sk_...`) must never go in `index.html`, this repo or a chat: anyone who opens the page could read it and move money. It belongs on a server as an environment secret; that server is what `orderEndpoint` points at.

**What an order contains**: reference, size, price, status, email (reservations only), a thumbnail, and the recipe (mode, palette, grid, texture, every tile's colours, the text or QR link). In Image mode it also stores the small square crop the artwork is drawn from, so the print can be remade without the original photo.

**Where orders are stored**

- As a claude.ai artifact: `orders/<viewer id>/items/<reference>` in the artifact's database. Only the artifact owner and editors can read all orders; each buyer reads and writes only their own. Because buyers can write their own order, never treat its `status` field as proof of payment. Stripe is the record of who paid.
- On claude.ai, people outside your organisation can open a shared artifact but cannot write to its database, so they cannot order. Selling to the public needs the self-hosted route (`orderEndpoint`).
- Opened as a plain file with no `orderEndpoint`, Buy only offers the PNG.

The page cannot see whether a Stripe payment succeeded. Statuses the page understands, for whoever updates orders by hand: `reserved`, `awaiting_payment`, `paid`, `printing`, `shipped`, `cancelled`.

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
- A small order server: creates Stripe Checkout Sessions, marks orders paid from the webhook, and passes them to a print-on-demand service.
- Prune or roll up old `saves` rows before the shared store's 25,000-document cap.
