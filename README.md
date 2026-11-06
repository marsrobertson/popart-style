# Pop Art Mixer

Press **Random** until the colours look good, then press **Save**. No thinking required.

One self-contained page (`index.html`): open it in a browser, or serve the repo root with GitHub Pages.

## What it does

- **Text**: two big lines plus a small line (`ART / is part of / MARKETING`). Put `|` between options in the small line (`is part of | is`) and each tile picks one. Turn on "swap" and every other tile flips the big lines, so you get "ART IS MARKETING" next to "MARKETING IS ART".
- **Image**: upload, drop or paste a picture. It's flattened to three tones (shadow, middle, highlight), and each tile paints those tones in its own colours. The Detail slider sets how blobby or sharp it gets.
- **QR code**: enter a link and an optional caption. QR tiles only use a darker code on a lighter colour with a contrast ratio of at least 4:1, so they stay scannable.
- **Grid**: 3×3 or 2×2. **Texture**: none, film grain, or Ben-Day dots.

## Controls

| Action | Button | Key |
|---|---|---|
| New colours for every tile | Random | `Space` |
| New colours for one tile | click the tile | |
| Undo the last roll | Back | `Z` |
| Download an 1800×1800 PNG | Save | `S` |

Saved images also appear in "Your picks" under the grid for the current tab only. Nothing is uploaded anywhere.

## How the colours are picked

Each tile picks a background, then a "big text" colour that works with it. A pair passes if its brightness contrast is at least 2.2:1, **or** if the hues are at least 100° apart on the colour wheel. That second rule is what allows the vibrating low-contrast pop pairs (pink on teal, cyan on orange) and blocks muddy ones (red on violet). The small line goes white or black, whichever reads better on the background. Tiles on screen don't share a background colour.

## Ideas for later

- A public gallery: users submit their best picks and vote.
- Log which palettes get saved and weight the randomiser toward them.
