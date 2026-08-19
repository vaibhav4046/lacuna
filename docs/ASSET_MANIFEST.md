# Asset manifest

Every file `web/public` ships, where it came from, and what it is licensed
under. This is the inventory that [THIRD_PARTY.md](../THIRD_PARTY.md) points at
for code; it does the same job for the bytes the browser downloads.

The licences below were not taken from memory. Every `.woff2` was decompressed
and its `name` table was read, so the copyright string, the version and the
licence URL quoted here are the ones inside the shipped file. The method is
recorded at the end so the check can be repeated.

## What ships

Eleven files, 116,152 bytes in total. All eleven are tracked in git, and all
eleven reach the browser: `vercel.json` sets `outputDirectory` to `web/dist`,
and a build puts `boot.css`, `favicon.svg` and `fonts/` there unchanged
alongside the hashed bundle.

| File | Bytes | Purpose | Origin | Licence |
|---|---|---|---|---|
| `boot.css` | 1,504 | Paints the page black before any script runs, and styles the no-JavaScript recovery block | First-party, written for this project | Apache-2.0, with the repository |
| `favicon.svg` | 416 | Browser tab icon. The Lacuna mark on a black square | First-party, same geometry as `web/src/design/mark.tsx` | Apache-2.0, with the repository |
| `fonts/jetbrains-mono-latin.woff2` | 31,432 | JetBrains Mono, Latin subset | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/jetbrains-mono-latin-ext.woff2` | 11,624 | JetBrains Mono, Latin Extended | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/jetbrains-mono-cyrillic.woff2` | 8,872 | JetBrains Mono, Cyrillic | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/jetbrains-mono-cyrillic-ext.woff2` | 1,640 | JetBrains Mono, Cyrillic Extended | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/jetbrains-mono-greek.woff2` | 6,836 | JetBrains Mono, Greek | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/jetbrains-mono-vietnamese.woff2` | 5,888 | JetBrains Mono, Vietnamese | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/space-grotesk-latin.woff2` | 22,288 | Space Grotesk, Latin subset | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/space-grotesk-latin-ext.woff2` | 18,940 | Space Grotesk, Latin Extended | Google Fonts, self-hosted | SIL Open Font License |
| `fonts/space-grotesk-vietnamese.woff2` | 6,712 | Space Grotesk, Vietnamese | Google Fonts, self-hosted | SIL Open Font License |

Fonts are 114,232 of the 116,152 bytes. Everything else the page loads is the
hashed JavaScript and CSS that Vite emits from source, plus the sixteen icons,
which are inline `data:` URIs built in `web/src/design/icons.ts` and are
therefore part of the bundle rather than files.

There are no images. No `.png`, `.jpg`, `.webp`, `.gif` or `.ico` is referenced
anywhere in `web/src` or in `web/index.html`. The two SVGs in the product are
the favicon and the mark, and both are first-party.

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

`THIRD_PARTY.md` currently says, under **Content and assets**:

> **Fonts, illustrations, music, video:** none used. Anything added later will
> be either originally produced for this project or carry a license permitting
> the use, recorded here with a link to that license.

**That line is out of date and this manifest contradicts it on the evidence.**
Nine font files totalling 114,232 bytes are committed under
`web/public/fonts/`, are referenced by twenty-one `@font-face` rules in
`web/src/styles.css`, and are served from the deployment. The fonts were added
on 2026-08-18 according to their file timestamps, after `THIRD_PARTY.md` was
last touched on 2026-08-15.

The good news is that the substance of the rule was kept even though the record
was not updated. The second sentence of that entry sets the standard: anything
added later must carry a licence permitting the use, recorded with a link. Both
families do. They are under the SIL Open Font License, which permits
redistribution and web embedding, and each file names the licence URL in its
own `name` table. So this is a bookkeeping failure, not a licensing one.

**Everything else in this manifest is consistent with `THIRD_PARTY.md`.**
`boot.css` and `favicon.svg` are first-party and fall under the repository's
own Apache-2.0 licence, which that file records. No illustrations, music or
video are used, which is still true.

### Not covered by THIRD_PARTY.md

For the avoidance of doubt, these are the manifest entries that file does not
currently mention at all:

- All nine `.woff2` files, for the reason above
- `web/public/boot.css`, which is first-party and arguably does not need an
  entry, but is listed here because a manifest that omits a shipped file is not
  a manifest
- `web/public/favicon.svg`, same

## One licence obligation that is not met

Stated plainly because the point of this document is to be checkable.

The SIL Open Font License requires that the copyright notice and the licence
text travel with the font when it is redistributed. Redistribution is what
self-hosting is: these files are served from Lacuna's own origin rather than
linked from Google's.

Each file carries the copyright notice in its `name` table and a URL pointing at
the licence. **None of the nine embeds the licence text itself**, which was
checked by reading name ID 13 out of every file and finding it absent in all
nine. Google's subsetting pipeline strips it and keeps only the URL. There is
also no `OFL.txt` or equivalent anywhere under `web/public/fonts/`, and a search
of the repository finds no font licence file at all.

The fix is to add the two upstream `OFL.txt` files next to the fonts, or a
single `web/public/fonts/LICENSE.md` naming both families with their copyright
lines and the licence URL, and to add a row to `THIRD_PARTY.md`. It is a small
change and it is not a code change. It was not made here because this is an
audit.

## What could not be verified

- **The upstream OFL text was not fetched in this session.** The licence
  identification rests on the URL each file names and on the project names in
  its copyright string. That the URL resolves to the SIL Open Font License 1.1
  specifically, rather than another version, was not confirmed against the
  network.
- **Provenance beyond the file contents was not established.** The files are
  consistent with Google Fonts output, and the stylesheet says that is what
  they are, but no download record or checksum against an upstream release
  exists in the repository to prove it. What can be said is what the binaries
  themselves declare, which is quoted above verbatim.
- **`web/dist` was inspected as it exists on this disk.** A clean rebuild was
  not run as part of this audit, so the statement that the build copies
  `public/` through unchanged is based on the current `dist` contents and on
  Vite's documented behaviour rather than on a build performed here.

## How to repeat the check

The font metadata above was read directly from the shipped binaries, not from a
package manifest. A `.woff2` is a brotli-compressed stream behind a table
directory, so reading it needs three steps: parse the WOFF2 table directory to
find the offset of the `name` table, `brotliDecompressSync` the compressed
block, then parse the `name` table records and read name IDs 0, 5, 13 and 14.
Node has everything required in `zlib`. The same walk reports whether `fvar` is
present, which is how the variable-font question above was settled.
