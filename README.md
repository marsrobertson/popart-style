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

## Where taste data lives

- Opened as a plain file or on GitHub Pages, it stays in that browser (`localStorage`, last 500 choices). Nothing is uploaded.
- Published as a claude.ai artifact, each choice is also stored in the artifact's shared database (`saves` collection: colour pairs, mode, palette, grid, time; no user names). The page reads the latest 1000 to weight Random, so everyone's picks shape everyone's rolls.

## How the colours are picked

Each tile picks a background, then a "big text" colour that works with it. A pair passes if its brightness contrast is at least 2.2:1, **or** if the hues are at least 100° apart on the colour wheel. That second rule is what allows the vibrating low-contrast pop pairs (pink on teal, cyan on orange) and blocks muddy ones (red on violet). The small line goes white or black, whichever reads better on the background. Tiles on screen don't share a background colour.

## Ideas for later

- A public gallery: users submit their best picks and vote.
- Prune or roll up old `saves` rows before the shared store's 25,000-document cap.
