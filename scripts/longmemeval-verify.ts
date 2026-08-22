import { existsSync } from 'node:fs';

import { assertOfficialOracleDataset, OFFICIAL_ORACLE } from '../benchmarks/longmemeval/integrity.js';
import { loadDataset } from '../benchmarks/longmemeval/load.js';

const path = process.argv[2] ?? 'data/longmemeval_oracle.json';
if (!existsSync(path)) {
  throw new Error(`Missing ${path}. Download the pinned ${OFFICIAL_ORACLE.file} before verifying it.`);
}

const records = loadDataset(path);
const identity = assertOfficialOracleDataset(path, records);
process.stdout.write(
  `Verified official LongMemEval oracle: ${identity.questions} questions, `
  + `${identity.bytes} bytes, sha256=${identity.sha256}\n`
  + `sorted question-id sha256=${identity.sortedQuestionIdsSha256}\n`
  + 'No judge was run and no benchmark score was produced.\n',
);
