# Lacuna demo film — design

## What it is

131 seconds, 1920×1080, 30 fps, H.264 with AAC narration and a caption track.
The hackathon's ceiling is three minutes; this comes in under two and a quarter
because there is nothing else to say.

## The rule the film follows

Every screen in it is a capture of the deployed product answering a real
question, taken by `npm run screens -- <url> --live` against
`https://lacuna-five.vercel.app`. No mockups, no re-typed values, no screen
recorded from a local build with different data. The traces, the millisecond
readings and the `LIVE` markers visible in the frames are the ones production
returned while the shutter was open.

Nothing is animated to look like reasoning. The one moving element carried over
from the product is its own Memory Gravity Field, which is in the captures
because it is on the page.

## Structure

| Scene | Length | What is on screen |
| --- | --- | --- |
| s01 open | 6.2s | Wordmark, the promise |
| s02 problem | 15.8s | Four sources, one question, no answer |
| s03 project | 12.6s | Conversations → claims → answer |
| s04–s08 | 49.4s | One pan down the live `/judge` page, five outcomes |
| s09 hydradb | 13.3s | The deployed HydraDB screen, four checks passing |
| s10 benchmark | 14.9s | Five baselines and this product, from the artifact |
| s11 parity | 9.5s | Node versus cloud, identical |
| s12 close | 8.1s | One context. Any agent. The two links. |

The five demo scenes are one continuous pan rather than five cuts, because
cutting between five crops of one screenshot would be five cuts pretending to
be five screens. Panning is what a reader does, and it keeps the rows above and
below in frame, which is the point: the outcomes differ.

## Palette and type

The product's own, unchanged. Pure `#000000`, white and `#BDBDBD` type,
`#8052FF` for interaction, `#FFB829` for the evidence spark. Space Grotesk and
JetBrains Mono, self-hosted from the same woff2 files the site serves.

Two greys were lightened from the site's `#5E5E5E` to `#757575` and `#8C8C8C`,
because at 1080p over black the original fails WCAG AA and `hyperframes check`
said so. Contrast now passes 8 of 8.

## How it is built

    node narrate.mjs     ElevenLabs, one clip per scene, durations measured
    node build.mjs       writes index.html, cut to those durations
    node captions.mjs    writes the SRT from the script and the same durations
    npx hyperframes check
    npx hyperframes render --output renders/lacuna-demo.mp4

`build.mjs` is the whole edit. There is no hand-placed timing in the film: each
scene lasts as long as its own narration clip plus a fixed 1.4 second breath, so
re-recording a line moves the timeline rather than desynchronising it.

## Honest limits

- The captions' scene boundaries are exact and their in-scene cue boundaries are
  split by word count. That is an estimate. whisper.cpp would give real word
  timings and is not installed here; building it to shave tenths off a cue
  boundary was not worth the dependency.
- Latency is never narrated. It is measured per request and it is legible in
  every frame; a spoken figure would be one run's number presented as a property
  of the product.
- The rendered MP4 is not committed. It is 28 MB of derived output, and this
  file plus `narration.json` and the captured PNGs regenerate it exactly.
