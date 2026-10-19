import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeWithPrev, splitAt } from "../lib/edit.ts";
import { parseAnalysis, toPlatformFormat, mergeAnalysis, CHUNK } from "../lib/prompt.ts";

const doc = () => ({
  sentences: [
    { i: 0, start: 0, end: 2, text: "Hi there." },
    { i: 1, start: 2, end: 4, text: "So," },
    { i: 2, start: 4, end: 8, text: "let me walk you through it." },
    { i: 3, start: 8, end: 9, text: "Okay." },
  ],
  analysis: {
    translations: ["안녕.", "그래서,", "차근차근 설명할게.", "좋아."],
    expressions: [{ phrase: "walk you through", meaning: "", sentence: 2, pattern: "", why: "", examples: [], collocations: [], related: [] }],
    tips: [{ sentence: 3, focus: "Okay", tip: "" }],
  },
  done: [0, 2, 3],
  cursor: 3,
});

test("merge shifts indices and translations", () => {
  const d = mergeWithPrev(doc(), 2);
  assert.equal(d.sentences.length, 3);
  assert.equal(d.sentences[1].text, "So, let me walk you through it.");
  assert.deepEqual([d.sentences[1].start, d.sentences[1].end], [2, 8]);
  assert.deepEqual(d.sentences.map((s) => s.i), [0, 1, 2]);
  assert.deepEqual(d.analysis!.translations, ["안녕.", "그래서, 차근차근 설명할게.", "좋아."]);
  assert.equal(d.analysis!.expressions[0].sentence, 1);
  assert.equal(d.analysis!.tips![0].sentence, 2);
  assert.deepEqual(d.done.sort(), [0, 2]);
  assert.equal(d.cursor, 2);
});

test("split shifts indices", () => {
  const d = splitAt(doc(), 2, 2); // "let me" | "walk you through it."
  assert.equal(d.sentences.length, 5);
  assert.equal(d.sentences[2].text, "let me");
  assert.equal(d.sentences[3].text, "walk you through it.");
  assert.ok(d.sentences[2].end > 4 && d.sentences[3].start < 8);
  assert.equal(d.analysis!.translations.length, 5);
  assert.equal(d.analysis!.expressions[0].sentence, 2);
  assert.equal(d.analysis!.tips![0].sentence, 4);
  assert.deepEqual(d.done.sort(), [0, 4]);
  assert.equal(d.cursor, 4);
});

test("parseAnalysis tolerates fences and string related", () => {
  const a = parseAnalysis('Here you go:\n```json\n{"translations":["a"],"expressions":[{"phrase":"go over","meaning":"검토하다","sentence":"0","related":["review"],"examples":["Let\'s go over it."]}],"tips":[{"sentence":0,"focus":"go over","tip":"연음"}]}\n```');
  assert.ok(a);
  assert.equal(a!.expressions[0].sentence, 0);
  assert.deepEqual(a!.expressions[0].related, [{ phrase: "review", note: "" }]);
  assert.equal(a!.tips!.length, 1);
  assert.equal(parseAnalysis("no json here"), null);
});

test("platform format", () => {
  const out = toPlatformFormat(
    { phrase: "walk you through", meaning: "차근차근 설명하다", sentence: 2, pattern: "walk [sb] through [sth]", why: "발표", examples: ["Let me walk you through the flow."], collocations: ["walk you through the process"], related: [{ phrase: "go over", note: "더 가볍게" }] },
    "Let me walk you through it.",
  );
  assert.match(out, /^WORD: walk you through/);
  assert.match(out, /REVIEW: Let me _____ it\./);
  assert.match(out, /RELATED: go over \(더 가볍게\)/);
});

test("mergeAnalysis places chunk translations at offset and dedupes", () => {
  const ex = (phrase: string, sentence: number) => ({ phrase, meaning: "", sentence, pattern: "", why: "", examples: [], collocations: [], related: [] });
  const total = CHUNK * 2 + 5;
  const first = mergeAnalysis(undefined, { translations: ["a0", "a1"], expressions: [ex("go over", 1)] }, 0, total);
  assert.equal(first.translations.length, total);
  assert.deepEqual(first.chunks, [0]);
  const second = mergeAnalysis(first, { translations: ["b0", "b1"], expressions: [ex("Go over", CHUNK + 3), ex("dive in", CHUNK + 1)], tips: [{ sentence: CHUNK, focus: "x", tip: "" }] }, 1, total);
  assert.equal(second.translations[0], "a0");
  assert.equal(second.translations[CHUNK], "b0");
  assert.equal(second.translations[CHUNK + 1], "b1");
  assert.deepEqual(second.expressions.map((e) => e.phrase), ["go over", "dive in"]);
  assert.deepEqual(second.chunks, [0, 1]);
  assert.equal(second.tips!.length, 1);
});
