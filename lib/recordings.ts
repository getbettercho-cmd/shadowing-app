"use client";
// 문장별 내 녹음(최신 1개)을 IndexedDB에 저장한다.

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("shadow-recordings", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("recs");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction("recs", mode);
    const req = fn(t.objectStore("recs"));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
  });
}

export const recordings = {
  key: (videoId: string, i: number) => `${videoId}:${i}`,
  async get(videoId: string, i: number): Promise<Blob | undefined> {
    try {
      return (await tx<Blob>("readonly", (s) => s.get(this.key(videoId, i)))) ?? undefined;
    } catch {
      return undefined;
    }
  },
  async put(videoId: string, i: number, blob: Blob) {
    try {
      await tx("readwrite", (s) => void s.put(blob, this.key(videoId, i)));
    } catch {}
  },
};

/** 브라우저 마이크 녹음. 지원 안 하면 null */
export function canRecord(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export async function startRecording(): Promise<{ stop: () => Promise<Blob> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () =>
      new Promise<Blob>((res) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          res(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        };
        rec.stop();
      }),
  };
}
