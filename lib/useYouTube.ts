"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// 유튜브 IFrame Player API 최소 타입
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  destroy(): void;
};
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((res) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        res();
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      rej(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });

export function useYouTube(videoId: string) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let dead = false;
    loadApi().then(() => {
      if (dead || !hostRef.current || !window.YT) return;
      const el = document.createElement("div");
      hostRef.current.innerHTML = "";
      hostRef.current.appendChild(el);
      player.current = new window.YT.Player(el, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => !dead && setReady(true),
          onStateChange: (e: { data: number }) => !dead && setPlaying(e.data === 1),
        },
      });
    });
    return () => {
      dead = true;
      try {
        player.current?.destroy();
      } catch {}
      player.current = null;
      setReady(false);
    };
  }, [videoId]);

  const time = useCallback(() => player.current?.getCurrentTime() ?? 0, []);
  const seek = useCallback((s: number, play = true) => {
    player.current?.seekTo(s, true);
    if (play) player.current?.playVideo();
  }, []);
  const pause = useCallback(() => player.current?.pauseVideo(), []);
  const play = useCallback(() => player.current?.playVideo(), []);
  const setRate = useCallback((r: number) => player.current?.setPlaybackRate(r), []);

  /** start~end 구간만 재생하고 끝나면 멈춘다. 중간에 abort되면 멈추고 reject. */
  const playSegment = useCallback(async (start: number, end: number, signal?: AbortSignal) => {
    const p = player.current;
    if (!p) return;
    p.seekTo(start, true);
    p.playVideo();
    const startedAt = Date.now();
    try {
      // 재생이 실제로 시작될 때까지 대기 (최대 4초)
      while (p.getPlayerState() !== 1 && Date.now() - startedAt < 4000) await sleep(80, signal);
      while (p.getCurrentTime() < end - 0.05) {
        await sleep(50, signal);
        if (p.getPlayerState() === 2 && Date.now() - startedAt > 600) break; // 사용자가 멈춤
        if (Date.now() - startedAt > (end - start) * 1000 * 3 + 6000) break; // 안전장치
      }
    } finally {
      p.pauseVideo();
    }
  }, []);

  return { hostRef, ready, playing, time, seek, pause, play, setRate, playSegment, sleep };
}

export { sleep };
