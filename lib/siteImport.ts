// 다른 쉐도잉 사이트(shadowingenglish.com) 레슨 페이지에서 문장·어휘·발음을 꺼내고,
// 유튜브 자막의 단어 시간에 그 문장들을 맞춘다.
import { decodeEntities, parseYouTubeId, type Cue, type Sentence } from "./transcript.ts";

export type VocabItem = { word: string; pos: string; ipa: string; meaning: string };
export type SiteLesson = {
  site: string;
  url: string;
  videoId: string | null;
  title: string;
  sentences: string[];
  vocab: VocabItem[];
  pronunciation: string[];
  summary: string;
};

export const ALLOWED_SITES = ["shadowingenglish.com"];

export function isSiteLesson(url: string): boolean {
  try {
    const h = new URL(url.trim()).hostname.replace(/^www\./, "");
    return ALLOWED_SITES.includes(h);
  } catch {
    return false;
  }
}

const text = (h: string) =>
  decodeEntities(h.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** 제목(h2/h3)부터 다음 제목 전까지의 HTML */
function section(html: string, heading: RegExp): string {
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (heading.test(text(m[1]))) {
      const from = m.index + m[0].length;
      const next = html.slice(from).search(/<h[23][^>]*>/);
      return html.slice(from, next < 0 ? undefined : from + next);
    }
  }
  return "";
}

export function parseLessonHtml(html: string, url = ""): SiteLesson {
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? url;
  const embed = html.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/)?.[1];
  const videoId = embed ?? parseYouTubeId(canonical) ?? (url ? parseYouTubeId(url) : null);

  const h1 = text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "");
  const title = h1.replace(/^[^:：]{1,20}[:：]\s*/, "").replace(/\s+-\s+[^-]*$/, "").trim();

  const sentences = [...html.matchAll(/<div class="sentence-content-text">([\s\S]*?)<\/div>/g)]
    .map((m) => text(m[1]))
    .filter(Boolean);

  const vocabHtml = section(html, /핵심 어휘|key vocabulary|vocabulary/i) || html;
  const vocab: VocabItem[] = [];
  for (const row of vocabHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 3) continue;
    const word = text(cells[0].match(/<strong>([\s\S]*?)<\/strong>/)?.[1] ?? cells[0]);
    const pos = text(cells[0].match(/<small>([\s\S]*?)<\/small>/)?.[1] ?? "");
    vocab.push({ word, pos, ipa: text(cells[1]), meaning: text(cells[2]) });
  }

  const pronHtml = section(html, /주의할 발음|pronunciation/i);
  const pronunciation = [...pronHtml.matchAll(/<(p|li)[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => text(m[2])).filter(Boolean);

  const summary = text(section(html, /어휘와 말하기 포인트|vocabulary and speaking/i).match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");

  let site = "";
  try {
    site = new URL(canonical).hostname.replace(/^www\./, "");
  } catch {}
  return { site, url: canonical, videoId, title, sentences, vocab, pronunciation, summary };
}

/* ---------- 시간 맞추기 ---------- */

const norm = (w: string) =>
  w
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]/g, "");

type TW = { w: string; t0: number; t1: number };

function captionWords(cues: Cue[]): TW[] {
  const out: TW[] = [];
  for (const c of cues) {
    // "actor/model" 같은 자막 토큰은 단어로 쪼갠다
    const ws = c.text.split(/[\s/]+/).filter((w) => norm(w));
    const total = ws.reduce((n, w) => n + w.length + 1, 0);
    let t = c.start;
    const span = Math.max(0.2, c.end - c.start);
    for (const w of ws) {
      const d = (span * (w.length + 1)) / total;
      out.push({ w, t0: t, t1: t + d });
      t += d;
    }
  }
  return out;
}

// 자막과 사이트 문장에서 같은 말을 다르게 적는 경우
const SAME: Record<string, string> = { cuz: "because", cause: "because", gonna: "goingto", wanna: "wantto", gotta: "gotto", ok: "okay", yeah: "yes", yep: "yes" };
const canon = (w: string) => SAME[w] ?? w;

/**
 * 사이트 문장(시간 없음)을 유튜브 자막 단어 시간에 맞춘다.
 * 문장 텍스트는 사이트 것을 그대로 쓰고, 시작·끝 시간만 자막에서 가져온다.
 */
export function alignSentences(cues: Cue[], siteSentences: string[]): Sentence[] {
  const W = captionWords(cues);
  const T: { n: string; s: number }[] = [];
  siteSentences.forEach((sent, s) => {
    for (const w of sent.split(/\s+/)) {
      const n = norm(w);
      if (n) T.push({ n, s });
    }
  });
  const hit: number[][] = siteSentences.map(() => []);
  const eq = (a: string, b: string) => a === b || canon(a) === canon(b) || (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)));

  let i = 0;
  let j = 0;
  const LOOK = 8;
  while (i < W.length && j < T.length) {
    const a = norm(W[i].w);
    const b = T[j].n;
    if (eq(a, b)) {
      hit[T[j].s].push(i);
      i++;
      j++;
      continue;
    }
    let moved = false;
    for (let k = 1; k <= LOOK && !moved; k++) {
      if (j + k < T.length && eq(a, T[j + k].n)) {
        j += k; // 사이트에만 있는 단어
        moved = true;
      } else if (i + k < W.length && eq(norm(W[i + k].w), b)) {
        i += k; // 자막에만 있는 단어
        moved = true;
      }
    }
    if (!moved) {
      hit[T[j].s].push(i); // 다르게 적힌 같은 자리의 단어
      i++;
      j++;
    }
  }

  // 문장별 시간. 맞춘 단어가 없는 문장은 앞뒤 사이로 채운다
  const raw = hit.map((h) => (h.length ? { start: W[Math.min(...h)].t0, end: W[Math.max(...h)].t1 } : null));
  const out: Sentence[] = [];
  for (let k = 0; k < siteSentences.length; k++) {
    let r = raw[k];
    if (!r) {
      const prevEnd = out[k - 1]?.end ?? cues[0]?.start ?? 0;
      const nextStart = raw.slice(k + 1).find(Boolean)?.start ?? prevEnd + 2;
      const words = siteSentences[k].split(/\s+/).length;
      r = { start: prevEnd, end: Math.min(nextStart, prevEnd + Math.max(0.8, words * 0.35)) };
    }
    const prev = out[k - 1];
    const start = Math.max(prev ? prev.start + 0.05 : 0, r.start - 0.15);
    out.push({ i: k, start: round(start), end: round(Math.max(start + 0.5, r.end + 0.3)), text: siteSentences[k] });
  }
  // 다음 문장 시작을 넘지 않게
  for (let k = 0; k < out.length - 1; k++) {
    const cap = out[k + 1].start + 0.05;
    if (out[k].end > cap) out[k].end = round(Math.max(out[k].start + 0.3, cap));
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
