import { runOfficialJudge, type OfficialJudgeModel } from '../benchmarks/longmemeval/judge.js';

function usage(): never {
  throw new Error(
    'Usage: npm run bench:longmemeval:judge -- --dataset <json> --hypotheses <jsonl> --out <jsonl> [--model gpt-4o|gpt-4o-mini|llama-3.1-70b-instruct] [--max-calls N]',
  );
}

function args(argv: readonly string[]): {
  dataset: string;
  hypotheses: string;
  out: string;
  model: OfficialJudgeModel;
  maxCalls: number | undefined;
} {
  let dataset: string | undefined;
  let hypotheses: string | undefined;
  let out: string | undefined;
  let model: OfficialJudgeModel = 'gpt-4o-mini';
  let maxCalls: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) usage();
    if (flag === '--dataset') dataset = value;
    else if (flag === '--hypotheses') hypotheses = value;
    else if (flag === '--out') out = value;
    else if (flag === '--model') model = value as OfficialJudgeModel;
    else if (flag === '--max-calls') {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--max-calls must be a positive integer');
      maxCalls = parsed;
    } else usage();
    i += 1;
  }
  if (dataset === undefined || hypotheses === undefined || out === undefined) usage();
  return { dataset, hypotheses, out, model, maxCalls };
}

const options = args(process.argv.slice(2));
const apiKey = process.env.OPENAI_API_KEY ?? '';
const judgeOptions = {
  model: options.model,
  apiKey,
  hypothesesPath: options.hypotheses,
  referencePath: options.dataset,
  outputPath: options.out,
  ...(options.maxCalls === undefined ? {} : { maxCalls: options.maxCalls }),
} as const;
const result = await runOfficialJudge(judgeOptions);
process.stdout.write(`Scored ${result.logs.length} hypotheses; accuracy=${result.accuracy.toFixed(4)}\n`);
