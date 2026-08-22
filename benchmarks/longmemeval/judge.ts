import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { isAbstention, type LongMemEvalRecord } from './schema.js';

export type OfficialJudgeModel = 'gpt-4o' | 'gpt-4o-mini' | 'llama-3.1-70b-instruct';

const MODEL_ZOO: Readonly<Record<OfficialJudgeModel, { readonly model: string; readonly baseUrl: string }>> = {
  'gpt-4o': { model: 'gpt-4o-2024-08-06', baseUrl: 'https://api.openai.com/v1' },
  'gpt-4o-mini': { model: 'gpt-4o-mini-2024-07-18', baseUrl: 'https://api.openai.com/v1' },
  'llama-3.1-70b-instruct': { model: 'meta-llama/Meta-Llama-3.1-70B-Instruct', baseUrl: 'http://localhost:8001/v1' },
};

export function supportedJudgeModel(model: string): string {
  if (!Object.hasOwn(MODEL_ZOO, model)) throw new Error(`unsupported judge model: ${model}`);
  return MODEL_ZOO[model as OfficialJudgeModel]!.model;
}

export function judgeBaseUrl(model: OfficialJudgeModel): string {
  return MODEL_ZOO[model].baseUrl;
}

/** Exact prompt branches from LongMemEval's published evaluate_qa.py. */
export function buildJudgePrompt(
  task: string,
  question: string,
  answer: string,
  response: string,
  abstention: boolean,
): string {
  if (abstention) {
    return `I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: ${question}\n\nExplanation: ${answer}\n\nModel Response: ${response}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.`;
  }
  if (task === 'temporal-reasoning') {
    return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. \n\nQuestion: ${question}\n\nCorrect Answer: ${answer}\n\nModel Response: ${response}\n\nIs the model response correct? Answer yes or no only.`;
  }
  if (task === 'knowledge-update') {
    return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: ${question}\n\nCorrect Answer: ${answer}\n\nModel Response: ${response}\n\nIs the model response correct? Answer yes or no only.`;
  }
  if (task === 'single-session-preference') {
    return `I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: ${question}\n\nRubric: ${answer}\n\nModel Response: ${response}\n\nIs the model response correct? Answer yes or no only.`;
  }
  if (task === 'single-session-user' || task === 'single-session-assistant' || task === 'multi-session') {
    return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: ${question}\n\nCorrect Answer: ${answer}\n\nModel Response: ${response}\n\nIs the model response correct? Answer yes or no only.`;
  }
  throw new Error(`unsupported LongMemEval question type: ${task}`);
}

export function parseJudgeLabel(value: string): boolean {
  return value.toLowerCase().includes('yes');
}

export interface JudgeOptions {
  readonly model: OfficialJudgeModel;
  readonly apiKey: string;
  readonly hypothesesPath: string;
  readonly referencePath: string;
  readonly outputPath: string;
  readonly maxCalls?: number;
  readonly timeoutMs?: number;
}

interface Hypothesis { readonly question_id: string; readonly hypothesis: string }
interface JudgeLog extends Hypothesis { readonly autoeval_label: { readonly model: string; readonly label: boolean } }

function readHypotheses(path: string): readonly Hypothesis[] {
  return readFileSync(path, 'utf8').split(/\r?\n/u).filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Hypothesis);
}

function jsonRecords(path: string): readonly LongMemEvalRecord[] {
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(value)) throw new Error('reference dataset must be a JSON array');
  return value as readonly LongMemEvalRecord[];
}

async function judgeOne(
  prompt: string,
  options: JudgeOptions,
  model: string,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
  try {
    const response = await fetch(`${MODEL_ZOO[options.model]!.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], n: 1, temperature: 0, max_tokens: 10 }),
    });
    if (!response.ok) throw new Error(`official judge request failed (${response.status})`);
    const body = await response.json() as { readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('official judge returned no label');
    return parseJudgeLabel(content.trim());
  } finally {
    clearTimeout(timeout);
  }
}

export async function runOfficialJudge(options: JudgeOptions): Promise<{ readonly accuracy: number; readonly logs: readonly JudgeLog[] }> {
  if (options.apiKey.trim() === '') throw new Error('OPENAI_API_KEY is required for the official judge');
  const model = supportedJudgeModel(options.model);
  const references = new Map(jsonRecords(options.referencePath).map((record) => [record.question_id, record]));
  const hypotheses = readHypotheses(options.hypothesesPath);
  const maxCalls = options.maxCalls ?? 500;
  if (hypotheses.length > maxCalls) throw new Error(`judge call budget exceeded: ${hypotheses.length} > ${maxCalls}`);
  const logs: JudgeLog[] = [];
  for (const hypothesis of hypotheses) {
    const reference = references.get(hypothesis.question_id);
    if (reference === undefined) continue;
    const prompt = buildJudgePrompt(
      reference.question_type,
      reference.question,
      String(reference.answer),
      hypothesis.hypothesis,
      isAbstention(hypothesis.question_id),
    );
    const label = await judgeOne(prompt, options, model);
    logs.push({ ...hypothesis, autoeval_label: { model, label } });
  }
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${logs.map((log) => JSON.stringify(log)).join('\n')}\n`, 'utf8');
  const accuracy = logs.length === 0 ? 0 : logs.filter((log) => log.autoeval_label.label).length / logs.length;
  return { accuracy, logs };
}
