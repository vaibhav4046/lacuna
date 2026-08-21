import { mkdir, readFile, writeFile } from "node:fs/promises";

const source = await readFile(new URL("./compositions/captions.html", import.meta.url), "utf8");
const sectionPattern = /\{\s*start:\s*([\d.]+),\s*end:\s*([\d.]+),\s*text:\s*("(?:\\.|[^"\\])*")\s*\}/g;
const sections = [];

for (const match of source.matchAll(sectionPattern)) {
  sections.push({
    start: Number(match[1]),
    end: Number(match[2]),
    text: JSON.parse(match[3]),
  });
}

if (sections.length !== 11) {
  throw new Error(`Expected 11 caption sections, found ${sections.length}`);
}

const splitSentences = (text) => text
  .split(/(?<=[.!?])\s+/)
  .map((sentence) => sentence.trim())
  .filter(Boolean);

const formatTime = (seconds) => {
  const totalMilliseconds = Math.round(seconds * 1000);
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
};

const cues = [];
for (const section of sections) {
  const sentences = splitSentences(section.text);
  const weights = sentences.map((sentence) => sentence.split(/\s+/).length);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = section.start;

  sentences.forEach((sentence, index) => {
    const span = ((section.end - section.start) * weights[index]) / totalWeight;
    cues.push({ start: cursor, end: cursor + span, text: sentence });
    cursor += span;
  });
}

const output = cues.map((cue, index) => [
  String(index + 1),
  `${formatTime(cue.start)} --> ${formatTime(cue.end)}`,
  cue.text,
].join("\n")).join("\n\n") + "\n";

const renderDirectory = new URL("./renders/", import.meta.url);
await mkdir(renderDirectory, { recursive: true });
const outputUrl = new URL("lacuna-v10-hack-hydra-final.srt", renderDirectory);
await writeFile(outputUrl, output, "utf8");

console.log(`Wrote ${cues.length} cues to ${outputUrl.pathname}`);
console.log(`Timeline: ${formatTime(cues[0].start)} -> ${formatTime(cues.at(-1).end)}`);
