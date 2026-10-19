"use client";
// 이 기기 브라우저(localStorage)에 학습 기록을 저장한다.
import type { Sentence } from "./transcript";
import type { Analysis, Expression } from "./prompt";
import type { VocabItem } from "./siteImport";

export type VideoRecord = {
  id: string;
  title: string;
  auto: boolean;
  sentences: Sentence[];
  analysis?: Analysis;
  /** 문장부호를 넣어 다시 나눴거나, 그대로 쓰기로 함 */
  punctFixed?: boolean;
  /** 다른 쉐도잉 사이트에서 가져온 레슨 정보 */
  site?: { url: string; vocab: VocabItem[]; pronunciation: string[]; summary: string };
  done: number[];
  cursor: number;
  addedAt: number;
  lastAt: number;
};

export type SavedExpr = Expression & { videoId: string; source: string; savedAt: number };

const K_VIDEOS = "shadow.videos.v1";
const K_SAVED = "shadow.saved.v1";
const K_SETTINGS = "shadow.settings.v1";

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export const store = {
  videos(): Record<string, VideoRecord> {
    return read(K_VIDEOS, {});
  },
  video(id: string): VideoRecord | undefined {
    return this.videos()[id];
  },
  putVideo(v: VideoRecord) {
    const all = this.videos();
    all[v.id] = { ...v, lastAt: Date.now() };
    write(K_VIDEOS, all);
  },
  removeVideo(id: string) {
    const all = this.videos();
    delete all[id];
    write(K_VIDEOS, all);
  },
  saved(): SavedExpr[] {
    return read(K_SAVED, []);
  },
  toggleSaved(e: Expression, videoId: string, source: string): boolean {
    const all = this.saved();
    const k = all.findIndex((x) => x.videoId === videoId && x.phrase === e.phrase);
    if (k >= 0) {
      all.splice(k, 1);
      write(K_SAVED, all);
      return false;
    }
    all.unshift({ ...e, videoId, source, savedAt: Date.now() });
    write(K_SAVED, all);
    return true;
  },
  isSaved(videoId: string, phrase: string) {
    return this.saved().some((x) => x.videoId === videoId && x.phrase === phrase);
  },
  settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K_SETTINGS, {}) };
  },
  setSettings(s: Settings) {
    write(K_SETTINGS, s);
  },
};

export type Settings = { rate: number; repeatGap: boolean; autoNext: boolean; showKo: boolean };
export const DEFAULT_SETTINGS: Settings = { rate: 1, repeatGap: true, autoNext: false, showKo: true };
