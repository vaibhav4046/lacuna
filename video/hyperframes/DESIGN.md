# Lacuna film design system

## Overview

Lacuna uses a high-contrast, black technical canvas with editorial-scale headings, compact mono labels, and precise product evidence. The live landing page is organized as a hero, an interactive question, a six-capability grid, temporal/conflict/abstention stories, architecture, HydraDB, clients, CLI, evaluations, and a final conversion. The Memory Gravity Field is the signature element: a ring of small source, claim, relation, and artifact glyphs that represents history orbiting a usable opening. The film must preserve captured product pixels exactly and use the surrounding composition—not filters—to focus attention.

## Colors

- **Primary surface**: `#000000` — full-bleed site and film canvas.
- **Raised surface**: `#030303` — subtle depth behind interface plates.
- **Panel surface**: `#0A0A0A` — terminal and dense proof panels.
- **Primary content**: `#FFFFFF` — headings, current answers, decisive proof.
- **Primary muted**: `#BDBDBD` — explanatory copy and evidence sentences.
- **Secondary muted**: `#9A9A9A` — metadata and inactive UI.
- **Lacuna violet**: `#8052FF` — action, selected state, current claim, path focus.
- **Evidence amber**: sparse captured amber pixels only — cited source and evidence spark; never a broad fill.

## Typography

- **Display and interface**: Space Grotesk 300/400/500. Hero at 113px in the capture; film hero may scale between 92px and 132px while retaining the same open grotesque rhythm. Section statements use 56–84px; product panels use 20–34px.
- **Evidence and controls**: JetBrains Mono 400/500. All-caps labels, command lines, paths, timestamps, status, and measured values; use 10–24px with deliberate tracking.
- **Hierarchy**: one large claim, one short supporting sentence, then the evidence or control. Do not compete with the product UI by adding a second headline over it.

## Elevation

Depth comes from 1px low-opacity dividers, scale, occlusion, and the violet focus state—not conventional shadows. Captured UI stays ungraded and flat to its original pixels. Film-only framing can use a near-black outer plate, a crisp 1px edge, and restrained violet/amber locator marks. No glass cards, generic bloom, heavy grain, or dusty color overlays.

## Components

- **Memory Aperture**: the Gravity Field ring; it rotates and reframes to reveal a different real artifact through its center.
- **Evidence Answer**: plain-English answer paired with standing, explanation, source sentence, timestamp, and inspectable artifact.
- **Temporal Claim Stack**: historical, proposal-never-current, and current rows held together instead of flattened.
- **Conflict Pair**: two disagreeing source records with neither silently selected.
- **Inspectable Graph**: interactive overview/proof path plus a one-row-per-edge readable table.
- **Agent Run Ledger**: Researcher → Reviewer lifecycle, bounded tools, persisted events, artifacts, retries, cancellation, and schedule.
- **Voice Orb**: explicit listening/thinking/speaking/interrupted/error states with typed fallback.
- **Context Architecture**: inputs → Lacuna policy/compiler/router/runtime → HydraDB persistent graph → clients and outcomes.
- **Lacuna Terminal**: real CLI and MCP transcript, including command, result, evidence, latency, and honest abstention.
- **Measured Proof Card**: test count, parity, context-token result, and the exact artifact path supporting the claim.

## Do's and Don'ts

### Do's

- Use the Memory Aperture once as a continuous spatial transition, revealing distinct product artifacts at each stop.
- Preserve every screenshot and recording without grading; crop, scale, reframe, and animate around it.
- Keep source sentences, row labels, command output, and measured artifact paths legible at 1080p.
- Use violet for the active proof path and amber only for cited evidence.
- Let each scene make one product claim and show the working proof for it.

### Don'ts

- Do not repeat the gravity ring as an empty background after it has served the transition.
- Do not leave large black holds with content entering late or below the frame.
- Do not simulate a chat, terminal, graph, result, cursor, or provider state that was not captured from the product.
- Do not stack large captions over dense application screens.
- Do not call an unconfigured provider ready, a local file adapter hosted-durable, or a generated benchmark independent.
