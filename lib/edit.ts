// 문장 합치기·나누기. 번역, 표현의 문장 번호, 완료 표시를 함께 맞춘다.
import type { Sentence } from "./transcript";
import type { Analysis } from "./prompt";

type Doc = { sentences: Sentence[]; analysis?: Analysis; done: number[]; cursor: number };

const reindex = (s: Sentence[]) => s.map((x, i) => ({ ...x, i }));

function shiftAnalysis(a: Analysis | undefined, map: (i: number) => number, translations: string[]): Analysis | undefined {
  if (!a) return a;
  return {
    translations,
    expressions: a.expressions.map((e) => ({ ...e, sentence: e.sentence >= 0 ? map(e.sentence) : e.sentence })),
    tips: a.tips?.map((t) => ({ ...t, sentence: map(t.sentence) })),
  };
}

/** i번 문장을 바로 앞 문장(i-1)과 합친다. */
export function mergeWithPrev<T extends Doc>(doc: T, i: number): T {
  if (i <= 0 || i >= doc.sentences.length) return doc;
  const s = doc.sentences;
  const merged: Sentence = { i: i - 1, start: s[i - 1].start, end: s[i].end, text: `${s[i - 1].text} ${s[i].text}` };
  const next = reindex([...s.slice(0, i - 1), merged, ...s.slice(i + 1)]);
  const map = (k: number) => (k >= i ? k - 1 : k);
  const tr = doc.analysis?.translations ?? [];
  const translations = tr.length ? [...tr.slice(0, i - 1), [tr[i - 1], tr[i]].filter(Boolean).join(" "), ...tr.slice(i + 1)] : tr;
  return {
    ...doc,
    sentences: next,
    analysis: shiftAnalysis(doc.analysis, map, translations),
    done: [...new Set(doc.done.filter((k) => k !== i && k !== i - 1).map(map))],
    cursor: map(doc.cursor),
  };
}

/** i번 문장을 wordIndex번째 단어 앞에서 둘로 나눈다. 시간은 글자 수 비율로 나눈다. */
export function splitAt<T extends Doc>(doc: T, i: number, wordIndex: number): T {
  const s = doc.sentences[i];
  if (!s) return doc;
  const words = s.text.split(" ");
  if (wordIndex <= 0 || wordIndex >= words.length) return doc;
  const a = words.slice(0, wordIndex).join(" ");
  const b = words.slice(wordIndex).join(" ");
  const cut = Math.round((s.start + ((s.end - s.start) * a.length) / s.text.length) * 100) / 100;
  const next = reindex([
    ...doc.sentences.slice(0, i),
    { i, start: s.start, end: cut + 0.15, text: a },
    { i: i + 1, start: Math.max(s.start, cut - 0.1), end: s.end, text: b },
    ...doc.sentences.slice(i + 1),
  ]);
  const map = (k: number) => (k > i ? k + 1 : k);
  const tr = doc.analysis?.translations ?? [];
  const translations = tr.length ? [...tr.slice(0, i + 1), "", ...tr.slice(i + 1)] : tr;
  return {
    ...doc,
    sentences: next,
    analysis: shiftAnalysis(doc.analysis, map, translations),
    done: [...new Set(doc.done.filter((k) => k !== i).map(map))],
    cursor: doc.cursor > i ? doc.cursor + 1 : doc.cursor,
  };
}
