# Asset manifest

Every file `web/public` ships, where it came from, and what it is licensed
under. This is the inventory that [THIRD_PARTY.md](../THIRD_PARTY.md) points at
for code; it does the same job for the bytes the browser downloads.

The licences below were not taken from memory. Every `.woff2` was decompressed
and its `name` table was read, so the copyright string, the version and the
licence URL quoted here are the ones inside the shipped file. The method is
recorded at the end so the check can be repeated.

## What ships

Fourteen files, 249,153 bytes in total. All fourteen are tracked in git, and all
fourteen reach the browser output: `vercel.json` sets `outputDirectory` to `web/dist`,
and a build puts `boot.css`, `favicon.svg` and `fonts/` there unchanged
alongside the hashed bundle.

| File | Bytes | Purpose | Origin | Licence |
|---|---|---|---|---|
| `boot.css` | 1,504 | Paints the page black before any script runs, and styles the no-JavaScript recovery block | First-party, written for this project | Apache-2.0, with the repository |
| `favicon.svg` | 416 | Browser tab icon. The Lacuna mark on a black square | First-party, same geometry as `web/src/design/mark.tsx` | Apache-2.0, with the repository |
| `mark-256.png` | 6,624 | 256×256 raster export of the Lacuna mark | First-party brand export | Apache-2.0, with the repository |
| `social.png` | 121,077 | 1200×630 social preview captured from the Lacuna product | First-party product capture | Apache-2.0, with the repository |
| `fonts/jetbrains-mono-latin.woff2` | 31,432 | JetBrains Mono, Latin subset | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/jetbrains-mono-latin-ext.woff2` | 11,624 | JetBrains Mono, Latin Extended | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/jetbrains-mono-cyrillic.woff2` | 8,872 | JetBrains Mono, Cyrillic | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/jetbrains-mono-cyrillic-ext.woff2` | 1,640 | JetBrains Mono, Cyrillic Extended | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/jetbrains-mono-greek.woff2` | 6,836 | JetBrains Mono, Greek | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/jetbrains-mono-vietnamese.woff2` | 5,888 | JetBrains Mono, Vietnamese | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/OFL.txt` | 5,300 | Copyright notices and redistribution licence for both font families | SIL Open Font License 1.1 text shipped with the fonts | SIL Open Font License 1.1 |
| `fonts/space-grotesk-latin.woff2` | 22,288 | Space Grotesk, Latin subset | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/space-grotesk-latin-ext.woff2` | 18,940 | Space Grotesk, Latin Extended | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/space-grotesk-vietnamese.woff2` | 6,712 | Space Grotesk, Vietnamese | Google Fonts, self-hosted | SIL Open Font License |

The nine font binaries are 114,232 bytes. Their licence text is 5,300 bytes.
The remaining 129,621 bytes are first-party browser assets. Application icons
are otherwise inline data URIs built in `web/src/design/icons.ts` and are part
of the generated bundle rather than separate files.

`social.png` is referenced by the Open Graph and Twitter metadata in
`web/index.html`. `mark-256.png` is a shipped raster brand export. There are no
third-party illustration, music or video files in `web/public`.

## The fonts in detail

### JetBrains Mono

- **Version:** 2.211, read from the font's `name` table, identical across all
  six subsets
- **Copyright:** `Copyright 2020 The JetBrains Mono Project Authors
  (https://github.com/JetBrains/JetBrainsMono)`
- **Licence URL in the file:** `https://scripts.sil.org/OFL`
- **Used for:** every monospace run in the product. `MONO` in
  `web/src/design/mark.tsx` is the one string that names it, and the whole
  interface imports that constant rather than repeating the stack

### Space Grotesk

- **Version:** 2.000, identical across all three subsets
- **Copyright:** `Copyright 2020 The Space Grotesk Project Authors
  (https://github.com/floriankarsten/space-grotesk)`
- **Licence URL in the file:** `https://scripts.sil.org/OFL`
- **Used for:** headings and body text, set as the `font-family` on `body` in
  `boot.css` so it applies before the bundle arrives

### Why nine files cover five weights

`web/src/styles.css` declares twenty-one `@font-face` blocks that resolve to
only nine distinct files. JetBrains Mono is declared at weights 400 and 500,
Space Grotesk at 300, 400 and 500, and in each case every weight points at the
same subset file.

That is correct rather than a mistake, and it was checked. All nine files carry
`fvar`, `gvar`, `avar` and `STAT` tables, which means all nine are variable
fonts. A variable font declared at a single weight has that weight applied to
its `wght` axis by the browser, so one file legitimately serves every declared
weight of its subset. This is exactly the output Google's font API produces for
a variable family, and the stylesheet's header comment says the blocks are that
output with the URLs rewritten. Both halves of that claim check out.

### Why they are self-hosted

`styles.css` explains it and the reason holds: nothing leaves the origin. That
is what lets the deployment run a content security policy without a
`fonts.googleapis.com` or `fonts.gstatic.com` exception, and it removes a
third-party request from the critical path of first paint.

## Against THIRD_PARTY.md

`THIRD_PARTY.md` records both font families, the nine self-hosted files and the
SIL Open Font License. It also distinguishes this browser asset inventory from
the separate submission film. That film uses product captures, first-party
motion graphics and ElevenLabs narration, but none of those media files are
served from `web/public`.

This manifest and `THIRD_PARTY.md` now agree. `boot.css` and `favicon.svg` are
first-party and fall under the repository's Apache-2.0 licence. The browser
ships no illustration, music or video asset.

### First-party entries not itemized by THIRD_PARTY.md

For the avoidance of doubt, these are the manifest entries that file does not
currently mention at all:

- `web/public/boot.css`, which is first-party and arguably does not need an
  entry, but is listed here because a manifest that omits a shipped file is not
  a manifest
- `web/public/favicon.svg`, same
- `web/public/mark-256.png`, same
- `web/public/social.png`, same

## Font licence obligation

The SIL Open Font License requires the copyright notice and licence text to
travel with redistributed font files. Lacuna meets that obligation with
`web/public/fonts/OFL.txt`. The file names JetBrains Mono and Space Grotesk,
includes their copyright notices, and carries the SIL Open Font License 1.1
text beside the nine self-hosted `.woff2` files. `THIRD_PARTY.md` records the
same shipped licence file.

The font binaries do not embed the full licence text in their `name` tables;
the adjacent tracked licence file is therefore the redistribution copy. Vite's
successful production build copied that file into the shipped public output.

## What could not be verified

- **Provenance beyond the file contents was not established.** The files are
  consistent with Google Fonts output, and the stylesheet says that is what
  they are, but no download record or checksum against an upstream release
  exists in the repository to prove it. What can be said is what the binaries
  themselves declare, which is quoted above verbatim.
- **Upstream binary checksums were not reconstructed.** The clean production
  build passed and copied `public/` into `web/dist`, but the repository does not
  contain an upstream release checksum ledger for the nine font binaries.

## How to repeat the check

The font metadata above was read directly from the shipped binaries, not from a
package manifest. A `.woff2` is a brotli-compressed stream behind a table
directory, so reading it needs three steps: parse the WOFF2 table directory to
find the offset of the `name` table, `brotliDecompressSync` the compressed
block, then parse the `name` table records and read name IDs 0, 5, 13 and 14.
Node has everything required in `zlib`. The same walk reports whether `fvar` is
present, which is how the variable-font question above was settled.
