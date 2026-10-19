// 자막 파싱과 문장 분할. 서버와 브라우저 양쪽에서 쓰는 순수 함수만 둔다.

export type Cue = { start: number; end: number; text: string };
export type Sentence = { i: number; start: number; end: number; text: string };

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m);
}

function cleanText(s: string): string {
  return decodeEntities(decodeEntities(s.replace(/<[^>]+>/g, "")))
    .replace(/\[[^\]]*\]/g, " ") // [Music], [Applause]
    .replace(/\(\s*(laughs?|music|applause|inaudible)\s*\)/gi, " ")
    .replace(/^\s*>>\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 유튜브 링크나 11자리 ID에서 영상 ID를 뽑는다. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/|\/v\/)([\w-]{11})/);
  if (m) return m[1];
  // 다른 쉐도잉 사이트 링크: 주소 끝이 영상 ID인 경우 (예: shadowingenglish.com/ko/practice/제목-vjpdPeVFW2M)
  try {
    const u = new URL(s);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    const t = last.match(/(?:^|-)([\w-]{11})$/);
    if (t && /\d|[A-Z]/.test(t[1])) return t[1];
  } catch {}
  return null;
}

/** 유튜브 timedtext 응답(XML 두 형식, json3)을 Cue 목록으로. */
export function parseCaptionPayload(body: string): Cue[] {
  const raw: { start: number; dur: number; text: string }[] = [];
  const t = body.trim();
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] };
      for (const e of j.events ?? []) {
        if (!e.segs) continue;
        raw.push({ start: (e.tStartMs ?? 0) / 1000, dur: (e.dDurationMs ?? 0) / 1000, text: e.segs.map((s) => s.utf8 ?? "").join("") });
      }
    } catch { /* fall through */ }
  } else {
    const reText = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    const reP = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
    const attr = (a: string, k: string) => {
      const m = a.match(new RegExp(`\\b${k}="([^"]*)"`));
      return m ? Number(m[1]) : NaN;
    };
    let m: RegExpExecArray | null;
    while ((m = reText.exec(t))) raw.push({ start: attr(m[1], "start"), dur: attr(m[1], "dur") || 0, text: m[2] });
    if (!raw.length) {
      while ((m = reP.exec(t))) raw.push({ start: attr(m[1], "t") / 1000, dur: (attr(m[1], "d") || 0) / 1000, text: m[2] });
    }
  }
  return finishCues(raw);
}

function finishCues(raw: { start: number; dur: number; text: string }[]): Cue[] {
  const items = raw
    .map((r) => ({ start: r.start, dur: r.dur, text: cleanText(r.text) }))
    .filter((r) => Number.isFinite(r.start) && r.text)
    .sort((a, b) => a.start - b.start);
  return items.map((r, k) => {
    const next = items[k + 1]?.start;
    let end = r.start + (r.dur > 0 ? r.dur : 3);
    if (next !== undefined && next > r.start && next < end) end = next; // 자동 자막은 구간이 겹친다
    return { start: r.start, end, text: r.text };
  });
}

function tsToSec(ts: string): number {
  const parts = ts.replace(",", ".").split(":").map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/**
 * 붙여넣은 자막 텍스트를 Cue로.
 * 지원: SRT, WebVTT, 유튜브 '스크립트 표시'에서 복사한 텍스트(타임스탬프 줄 + 문장 줄).
 */
export function parsePastedTranscript(text: string): Cue[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const raw: { start: number; dur: number; text: string }[] = [];

  if (lines.some((l) => l.includes("-->"))) {
    let cur: { start: number; dur: number; text: string } | null = null;
    for (const line of lines) {
      const m = line.match(/(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
      if (m) {
        if (cur) raw.push(cur);
        const [a, b] = line.split("-->").map((x) => tsToSec(x.trim().split(/\s/)[0]));
        cur = { start: a, dur: b - a, text: "" };
      } else if (cur && line.trim() && !/^\d+$/.test(line.trim())) {
        cur.text += " " + line;
      } else if (!line.trim() && cur) {
        raw.push(cur);
        cur = null;
      }
    }
    if (cur) raw.push(cur);
    return finishCues(raw.map((r) => ({ ...r, dur: r.dur > 0 ? r.dur : 3 })));
  }

  // 유튜브 스크립트 복사본
  const tsOnly = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
  const tsLead = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/;
  const durationLabel = /^(\d+\s*(시간|분|초)\s*)+$|^(\d+\s*(hours?|minutes?|seconds?),?\s*)+$/i;
  let cur: { start: number; text: string } | null = null;
  const pushed: { start: number; text: string }[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || durationLabel.test(line)) continue;
    if (tsOnly.test(line)) {
      if (cur) pushed.push(cur);
      cur = { start: tsToSec(line), text: "" };
      continue;
    }
    const lead = line.match(tsLead);
    if (lead) {
      if (cur) pushed.push(cur);
      cur = { start: tsToSec(lead[1]), text: lead[2] };
      continue;
    }
    if (cur) cur.text += " " + line;
  }
  if (cur) pushed.push(cur);
  return finishCues(
    pushed.map((p, k) => {
      // 붙여넣기 자막은 끝 시간이 없다. 다음 줄까지가 너무 길면 말하는 길이로 추정한다.
      const est = p.text.trim().split(/\s+/).length * 0.42 + 0.8;
      const gap = (pushed[k + 1]?.start ?? p.start + est) - p.start;
      return { start: p.start, dur: Math.min(gap, Math.max(est, 1.5)), text: p.text };
    }),
  );
}

const ABBREV = new Set(["mr.", "mrs.", "ms.", "dr.", "st.", "vs.", "e.g.", "i.e.", "etc.", "u.s.", "jr.", "sr.", "inc.", "co."]);

type Word = { w: string; t0: number; t1: number; cueEnd?: boolean };

function toWords(cues: Cue[]): Word[] {
  const words: Word[] = [];
  for (const c of cues) {
    const ws = c.text.split(" ").filter(Boolean);
    const total = ws.reduce((n, w) => n + w.length + 1, 0);
    let t = c.start;
    const span = Math.max(0.2, c.end - c.start);
    for (const w of ws) {
      const d = (span * (w.length + 1)) / total;
      words.push({ w, t0: t, t1: t + d });
      t += d;
    }
    if (words.length) words[words.length - 1].cueEnd = true;
  }
  return words;
}

function endsSentence(w: string): boolean {
  const lw = w.toLowerCase().replace(/["')\]]+$/, "");
  if (ABBREV.has(lw)) return false;
  return /[.?!…]$/.test(lw) && !/^\d+\.$/.test(lw);
}

/**
 * Cue를 따라 말하기 좋은 문장 단위로 다시 자른다.
 * 문장부호가 있으면 문장부호 기준, 자동 자막처럼 없으면 쉬는 구간과 길이 기준.
 */
export function toSentences(cues: Cue[], opts: { maxWords?: number; maxSec?: number } = {}): Sentence[] {
  const maxWords = opts.maxWords ?? 22;
  const maxSec = opts.maxSec ?? 9;
  const words = toWords(cues);
  if (!words.length) return [];
  const punctuated = words.filter((w) => endsSentence(w.w)).length >= Math.max(2, words.length / 40);

  // 자막 줄 경계(시간 공백) 계산용
  const gapAfter = (k: number) => (k + 1 < words.length ? words[k + 1].t0 - words[k].t1 : 99);

  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (let k = 0; k < words.length; k++) {
    cur.push(words[k]);
    const dur = cur[cur.length - 1].t1 - cur[0].t0;
    const w = words[k].w;
    if (punctuated) {
      let cut = false;
      if (endsSentence(w)) cut = true;
      else if (cur.length >= maxWords || dur >= maxSec) cut = /[,;:—-]$/.test(w) || cur.length >= maxWords + 8 || dur >= maxSec + 4;
      if (cut) {
        groups.push(cur);
        cur = [];
      }
    } else {
      const base = k - cur.length + 1; // cur[0]의 words 인덱스
      if (gapAfter(k) > 0.6 && cur.length >= 4) {
        groups.push(cur);
        cur = [];
      } else if (cur.length >= 16 || dur >= 7) {
        // 가장 길게 쉰 지점에서 자른다
        let best = cur.length - 1;
        let bestGap = -1;
        for (let j = 3; j < cur.length - 1; j++) {
          // 쉬는 시간이 길수록, 자막 줄이 끝나는 곳일수록 자르기 좋은 지점
          const g = gapAfter(base + j) + (cur[j].cueEnd ? 0.2 : 0);
          if (g >= bestGap) { bestGap = g; best = j; }
        }
        if (bestGap < 0.15) best = cur.length - 1;
        groups.push(cur.slice(0, best + 1));
        cur = cur.slice(best + 1);
      }
    }
  }
  if (cur.length) groups.push(cur);

  // 너무 짧은 조각은 다음 문장에 붙인다 (예: "So," 단독)
  const merged: Word[][] = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    if (prev && prev.length <= 1 && !endsSentence(prev[prev.length - 1].w)) {
      prev.push(...g);
    } else merged.push(g);
  }

  return merged.map((g, i) => {
    const start = Math.max(0, g[0].t0 - 0.15);
    const nextStart = merged[i + 1]?.[0].t0;
    let end = g[g.length - 1].t1 + 0.35;
    if (nextStart !== undefined) end = Math.min(end, nextStart + 0.05);
    return { i, start: round(start), end: round(Math.max(end, start + 0.6)), text: g.map((x) => x.w).join(" ") };
  });
}

const round = (n: number) => Math.round(n * 100) / 100;

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
