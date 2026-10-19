"use client";
// 홈에서 올린 레슨 파일을 학습 화면으로 넘겨준다 (새로고침에도 남도록 sessionStorage에도 둔다)
import type { SiteLesson } from "./siteImport";

const K = "shadow.pendingLesson";
let mem: SiteLesson | null = null;

export function putPendingLesson(l: SiteLesson) {
  mem = l;
  try {
    sessionStorage.setItem(K, JSON.stringify(l));
  } catch {}
}

export function takePendingLesson(videoId: string): SiteLesson | null {
  let l = mem;
  if (!l) {
    try {
      const v = sessionStorage.getItem(K);
      l = v ? (JSON.parse(v) as SiteLesson) : null;
    } catch {}
  }
  if (!l || l.videoId !== videoId) return null;
  mem = null;
  try {
    sessionStorage.removeItem(K);
  } catch {}
  return l;
}
