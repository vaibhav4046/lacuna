# V10 video thumbnail brief and asset manifest

## Deliverables

- YouTube thumbnail: 1280x720 PNG or JPEG, under 2 MB.
- Working master: 1920x1080 PNG.
- Suggested outputs:
  `artifacts/submission/v10-thumbnail-1280x720.png` and
  `artifacts/submission/v10-thumbnail-master-1920x1080.png`.

Do not publish either file until it is checked at 25% scale and beside the final
video title.

## One-frame idea

**Memory that knows what changed.**

Black field. The exact Lacuna mark sits in the left third, large enough for the
amber head and white spiral to survive a mobile preview. A real final-build
memory field occupies the right two-thirds with clear depth, three readable
evidence nodes and one selected proof path. The graph appears to be drawn out
of the mark, not placed beside it as a card.

Set the headline in two lines at lower left:

```text
MEMORY THAT KNOWS
WHAT CHANGED
```

Small proof line beneath: `HYDRADB · LIVE PRODUCT · 3 MIN DEMO`.

No dashboard collage, fake terminal, avatar, stock illustration, lens flare,
yellow fog, violet logo treatment or generic glowing aperture.

## Layout

| Region | Content |
| --- | --- |
| 0-38% | Exact mark at x 12%, y 16%; headline at x 8%, y 54%; proof line at y 82%. |
| 34-100% | Final V10 graph capture, cropped so the selected current claim and its evidence path are readable. |
| Centre seam | A sparse particle trail connects the mark's white tail to the graph. It must share the landing field's geometry. |

Keep all essential content inside a 5% safe margin. The mark cannot touch the
headline. The graph must remain recognizable after downscaling to 320x180.

## Brand tokens

| Role | Value |
| --- | --- |
| Canvas | `#000000` |
| Mark/body ink | `#FFFFFF` |
| Lacuna head and one proof highlight | `#FFB829` |
| Secondary text | `#9A9A9A` |
| HydraDB vendor tile | official `#ff5719` tile with its unmodified white stepped glyph |
| Display/body | Space Grotesk from `web/public/fonts/` |
| Technical line | JetBrains Mono from `web/public/fonts/` |

Amber belongs only to the Lacuna head and one proof highlight. It is not a glow
wash. Purple may appear inside an authentic product capture, but never on or
around the Lacuna mark.

## Approved asset manifest

| Asset | Source | Rule |
| --- | --- | --- |
| Canonical Lacuna raster | `web/public/mark-256.png` | Exact approved black, white and amber mark. Primary source for the thumbnail. |
| Canonical Lacuna vector | `web/public/favicon.svg` | Same white spiral and `#FFB829` head. Use for large clean export. |
| Logo geometry in product | `web/src/design/mark.tsx` | Source-of-truth path when the mark is animated. Preserve stroke ends and head position. |
| HydraDB mark | `HYDRADB_MARK` in `web/src/design/brand.ts` | Official orange tile and white stepped glyph. Use unmodified and only beside `HydraDB`. |
| Memory field | Fresh capture from the final accepted `/explore/graph` | Required. Do not use a stale V8 graph PNG after layout or data changes. |
| Proof edge | Fresh capture from final `mode=proof` | Optional overlay only when its source, evidence, claim and entity labels remain readable. |
| Fonts | `web/public/fonts/space-grotesk-*.woff2`, `jetbrains-mono-*.woff2` | Self-hosted OFL assets already inventoried in `ASSET_MANIFEST.md`. |

The older `design/reference/assets/lacuna-mark.svg` uses an orange head. It is
not the exact approved amber thumbnail mark. The V8 aperture frames, old graph
captures and rejected film contact sheets are not approved thumbnail sources.

## Acceptance checks

- [ ] Exact white spiral and amber head match `web/public/mark-256.png`.
- [ ] No purple appears in the logo or its halo.
- [ ] Headline is readable at 320x180 without sharpening.
- [ ] The graph is a final-product capture, not invented nodes.
- [ ] No token, account name, private workspace, browser chrome or local path is
      visible.
- [ ] HydraDB mark is unmodified and no vendor mark implies endorsement.
- [ ] Thumbnail and final film use the same black, white, amber and particle
      motion language.
