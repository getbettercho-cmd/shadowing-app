// 표현 추출 프롬프트. API 호출과 '프롬프트 복사' 방식이 같은 내용을 쓴다.

export type Related = { phrase: string; note: string };
export type Expression = {
  phrase: string;
  meaning: string;
  sentence: number;
  pattern: string;
  why: string;
  examples: string[];
  collocations: string[];
  related: Related[];
};
export type Tip = { sentence: number; focus: string; tip: string };
export type Analysis = { translations: string[]; expressions: Expression[]; tips?: Tip[]; chunks?: number[] };

/** 긴 영상은 이 문장 수씩 나눠서 분석한다 (약 3~5분 분량) */
export const CHUNK = 40;

/**
 * 한 구간(chunk번째, CHUNK 문장)의 분석 결과를 기존 결과에 합친다.
 * 번역은 구간 시작 위치에 맞춰 넣고, 표현은 같은 표현이면 건너뛴다.
 */
export function mergeAnalysis(prev: Analysis | undefined, next: Analysis, chunk: number, total: number): Analysis {
  const offset = chunk * CHUNK;
  const translations = Array.from({ length: total }, (_, k) => prev?.translations?.[k] ?? "");
  next.translations.slice(0, Math.min(CHUNK, total - offset)).forEach((t, j) => {
    if (t) translations[offset + j] = t;
  });
  const seen = new Set((prev?.expressions ?? []).map((e) => e.phrase.toLowerCase()));
  const expressions = [...(prev?.expressions ?? []), ...next.expressions.filter((e) => !seen.has(e.phrase.toLowerCase()))].sort(
    (a, b) => a.sentence - b.sentence,
  );
  const tips = [...(prev?.tips ?? []), ...(next.tips ?? [])].sort((a, b) => a.sentence - b.sentence);
  const chunks = [...new Set([...(prev?.chunks ?? (prev ? [0] : [])), chunk])].sort((a, b) => a - b);
  return { translations, expressions, tips, chunks };
}

export const MAX_SENTENCES = 160;

export function buildPrompt(title: string, sentences: { i: number; text: string }[]): string {
  const lines = sentences.slice(0, MAX_SENTENCES).map((s) => `[${s.i}] ${s.text}`).join("\n");
  return `You are helping a Korean UX planner/designer practice English by shadowing a YouTube video.
She is around OPIc IH level and wants to work at a foreign company, so she needs English she can actually say at work and in daily conversation.

Video title: ${title || "(unknown)"}
Transcript, one numbered sentence per line:
${lines}

Do three things.

1. translations: a natural Korean translation for EVERY numbered sentence above, in the same order (one string per sentence, ${Math.min(sentences.length, MAX_SENTENCES)} strings total, first string = sentence [${sentences[0]?.i ?? 0}]). Natural spoken Korean, not word-for-word.

2. expressions: pick the 8-12 most useful, reusable expressions from the transcript (phrasal verbs, collocations, sentence starters, fillers, idioms). Prefer ones she can reuse at work, in interviews or in OPIc answers. Skip single easy words. For each:
- phrase: as it appears (base form if it's a verb phrase)
- meaning: Korean meaning, short
- sentence: the [number] of the sentence where it appears (use the number shown in brackets)
- pattern: reusable frame, e.g. "walk [someone] through [something]"
- why: one short Korean line on when to use it (work / interview / daily)
- examples: 2 new natural example sentences, at least one about work (UX, product, meetings)
- collocations: 3-4 common combinations
- related: 2-4 connected expressions (similar meaning, a more formal or casual version, or an opposite), each with a short Korean note on the difference

3. tips: 3-6 pronunciation points for shadowing (linking, reductions like gonna/wanna, dropped t, stress, intonation). For each: sentence number, focus (the exact words, e.g. "want to → wanna"), and a short Korean tip on how to say it.

Reply with ONLY a JSON object, no other text:
{"translations":["..."],"expressions":[{"phrase":"","meaning":"","sentence":0,"pattern":"","why":"","examples":["",""],"collocations":[""],"related":[{"phrase":"","note":""}]}],"tips":[{"sentence":0,"focus":"","tip":""}]}`;
}

/** 모델 답변(또는 사용자가 붙여넣은 답변)에서 JSON을 꺼내 검증한다. */
export function parseAnalysis(text: string): Analysis | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let j: unknown;
  try {
    j = JSON.parse(body.slice(a, b + 1));
  } catch {
    return null;
  }
  const o = j as Partial<Analysis>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const expressions = arr(o.expressions)
    .map((e: Record<string, unknown>) => ({
      phrase: str(e.phrase),
      meaning: str(e.meaning),
      sentence: Number.isFinite(Number(e.sentence)) ? Number(e.sentence) : -1,
      pattern: str(e.pattern),
      why: str(e.why),
      examples: arr(e.examples).map(str).filter(Boolean),
      collocations: arr(e.collocations).map(str).filter(Boolean),
      related: arr(e.related)
        .map((r: unknown) => (typeof r === "string" ? { phrase: r, note: "" } : { phrase: str((r as Related).phrase), note: str((r as Related).note) }))
        .filter((r: Related) => r.phrase),
    }))
    .filter((e) => e.phrase);
  const translations = arr(o.translations).map(str);
  const tips = arr(o.tips)
    .map((t: Record<string, unknown>) => ({ sentence: Number(t.sentence), focus: str(t.focus), tip: str(t.tip) }))
    .filter((t) => t.focus && Number.isFinite(t.sentence));
  if (!expressions.length && !translations.length) return null;
  return { translations, expressions, tips };
}

/** 윤진님 영어 플랫폼 Input 형식(WORD/MEANING/PATTERN/COLLOCATIONS/EXAMPLES/RELATED/REVIEW)으로 변환 */
export function toPlatformFormat(e: Expression, source?: string): string {
  const cloze = source ? source.replace(new RegExp(e.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "_____") : "";
  return [
    `WORD: ${e.phrase}`,
    `MEANING: ${e.meaning}`,
    `PATTERN: ${e.pattern}`,
    `COLLOCATIONS: ${e.collocations.join(" / ")}`,
    `EXAMPLES:\n${e.examples.map((x) => `- ${x}`).join("\n")}`,
    `RELATED: ${e.related.map((r) => (r.note ? `${r.phrase} (${r.note})` : r.phrase)).join(" / ")}`,
    `REVIEW: ${cloze && cloze !== source ? cloze : e.why}`,
  ].join("\n");
}

/** 자동 자막 문장부호 넣기 프롬프트 */
export function buildPunctuatePrompt(text: string): string {
  return `This is an auto-generated English transcript from a YouTube video. It has no punctuation.
Add punctuation (. , ? !) and capitalization so it reads as natural sentences.

Rules:
- Keep every word exactly as it is, in the same order. Do not add, remove, fix or reorder any word, even repeated words or misheard words.
- Only add punctuation marks and change capitalization.
- Reply with only the punctuated transcript, as one paragraph, no other text.

Transcript:
${text}`;
}
