# Every claim the film makes, and where to check it

The demo video says twelve things. Each line below is one of them, with the
artifact or the URL a viewer can open to test it. Nothing is asserted in the
narration that is not in this table.

| Said | Checkable at |
| --- | --- |
| The deployed product answers questions live | https://lacuna-five.vercel.app/judge — six rows, computed on load |
| Every row is computed when the page loads | `web/src/pages/Judge.tsx`; no recorded reply, no branch on the question |
| Current state, answered with its sources | `/judge` row 1; `POST /api/ask` returns `ANSWERED` with evidence |
| A revised value keeps its history | `/judge` row 2; the envelope carries `revisions` |
| Sources that disagree are both kept | `/judge` row 3; status `CONFLICT`, reason `contradicted` |
| A value nobody stated gets no answer | `/judge` row 5; status `NO_EVIDENCE`, reason `never_stated` |
| A two hop question is answered and cited | `/judge` row 6; `via=vendor`, two sources |
| HydraDB Cloud holds 72 conversations and 86 entity records | `artifacts/hydra/cloud-ingest.json` — 159 records, all indexed, read back byte identical |
| Evidence and claims are stored apart | `src/hydra/cloud-graph.ts`; session records and entity records are different ids |
| Five baselines over 64 questions; best baseline 63 at 1843 tokens; Lacuna 64 at 18 | `artifacts/bench/results.json`, rendered live at `/demo/evals` |
| Node and cloud answer identically | `artifacts/hydra/cloud-parity.json` — `identical: true`, 64 questions, field by field |
| The repository and the deployment are public | https://github.com/vaibhav4046/lacuna · https://lacuna-five.vercel.app |

## What the film deliberately does not say

- **No latency figure is narrated.** It is measured per request and legible in
  every frame. A spoken number would be one run's reading presented as a
  property of the product.
- **No claim of winning.** The benchmark table is shown with each baseline at
  its own best cutoff, which is the reading least favourable to this product.
- **No user testimonial, no adoption number, no third-party endorsement.**
  There are none.

## Provenance of the frames

Every screen is a capture of production taken by
`npm run screens -- https://lacuna-five.vercel.app --live`, stored in
`artifacts/screens/live/`. Each capture is checked on write for its ground
colour and pixel density, so a blank frame cannot pass as a page.
