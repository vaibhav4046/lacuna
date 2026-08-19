import { MONO } from '../design/mark';

/**
 * The measured run, and exactly what it is a run of.
 *
 * This section used to say NO MEASURED RUN four times, which was true when it
 * was written and stopped being true once the evaluation and the scale curve
 * existed. Understating is not the safe direction it looks like: a page that
 * says nothing has been measured, beside a product that publishes its
 * artifacts, is wrong in a way a reader will find.
 *
 * Every number here is owned by artifacts/release/current.json and appears on
 * a screen that can be opened. The scope sits next to them rather than in a
 * footnote, because a generated evaluation reported without that word is a
 * benchmark result, and this is not one.
 */

const MEASURED: readonly { readonly value: string; readonly label: string; readonly scope: string }[] = [
  {
    value: '64 / 64',
    label: 'GENERATED EVALUATION',
    scope: 'Same generator wrote the corpus and the questions. Half of them have no answer.',
  },
  {
    value: '18.27',
    label: 'MEAN ANSWER CONTEXT TOKENS',
    scope: 'The strongest flat baseline reaches 63 of 64 and spends 1,843.',
  },
  {
    value: '117K',
    label: 'HISTORY TOKENS AT THE LARGEST POINT',
    scope: 'Measured at five sizes. History grew 6.89 times, answer context grew 1.00.',
  },
];

export function Evals() {
  return (
    <section id="evals" data-scene="quiet" style={{ position: 'relative', padding: '14vh clamp(20px, 4.4vw, 72px)' }}>
      <div style={{ maxWidth: '1040px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
        <h2 style={{ fontSize: 'clamp(38px, 4.4vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>
          Measure the context.<br />Then make the claim.
        </h2>
        <p style={{ fontSize: '17px', lineHeight: 1.7, color: '#9A9A9A', margin: 0, maxWidth: '56ch', textWrap: 'pretty' }}>
          These are measured, and they are measured on a corpus this project generated. That is a
          fair test of what to do with a claim graph and it is not a public benchmark, so it is
          labelled as what it is everywhere it appears.
        </p>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', marginTop: '8px' }}>
          {MEASURED.map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '28px',
                alignItems: 'baseline',
                padding: '20px 4px',
                borderBottom: '1px solid rgba(255,255,255,0.10)',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '210px' }}>
                <span style={{ fontSize: 'clamp(26px, 2.6vw, 38px)', fontWeight: 300, letterSpacing: '-0.02em', color: '#FFFFFF' }}>
                  {row.value}
                </span>
                <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#8052FF' }}>
                  {row.label}
                </span>
              </span>
              <span style={{ fontSize: '14.5px', lineHeight: 1.65, color: '#9A9A9A', maxWidth: '46ch' }}>
                {row.scope}
              </span>
            </div>
          ))}
        </div>

        <div style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#5E5E5E', lineHeight: 2.1 }}>
          0 FALSE ANSWERS · 32 CORRECT ABSTENTIONS · 5 REASON CODES
          <br />
          THE SCALE CURVE HOLDS THE CLAIM SET FIXED, SO IT MEASURES HISTORY VOLUME AND NOT CLAIM GROWTH
          <br />
          NO OFFICIAL LONGMEMEVAL SCORE EXISTS. THE REPOSITORY SAYS WHY
        </div>
      </div>
    </section>
  );
}
