"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useYouTube, sleep } from "@/lib/useYouTube";
import { store, type VideoRecord, type Settings, DEFAULT_SETTINGS } from "@/lib/store";
import { parsePastedTranscript, toSentences, fmtTime, type Sentence } from "@/lib/transcript";
import { buildPrompt, parseAnalysis, toPlatformFormat, mergeAnalysis, CHUNK, type Analysis, type Expression } from "@/lib/prompt";
import { mergeWithPrev, splitAt } from "@/lib/edit";
import { recordings, canRecord, startRecording } from "@/lib/recordings";

type Tab = "watch" | "drill" | "expr";
type Load = { state: "loading" } | { state: "ready" } | { state: "paste"; reason: string; title: string };

const REASONS: Record<string, string> = {
  no_captions: "이 영상에는 자막이 없어요.",
  no_english: "영어 자막이 없는 영상이에요.",
  fetch_failed: "유튜브에서 자막을 받아오지 못했어요.",
  network: "자막을 불러오는 중 연결이 끊겼어요.",
};

export default function StudyPage() {
  const { id } = useParams<{ id: string }>();
  const yt = useYouTube(id);
  const [rec, setRec] = useState<VideoRecord | null>(null);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [tab, setTab] = useState<Tab>("watch");
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => setSettingsState(store.settings()), []);
  const setSettings = (s: Settings) => {
    setSettingsState(s);
    store.setSettings(s);
  };

  const save = useCallback((v: VideoRecord) => {
    setRec(v);
    store.putVideo(v);
  }, []);

  // 저장된 기록 → 없으면 자막 자동 불러오기 → 실패하면 붙여넣기
  useEffect(() => {
    const saved = store.video(id);
    if (saved) {
      setRec(saved);
      setLoad({ state: "ready" });
      if (saved.done.length > 0) setTab("drill");
      return;
    }
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/transcript?v=${id}`);
        const j = await r.json();
        if (dead) return;
        if (!r.ok || !j.sentences?.length) {
          setLoad({ state: "paste", reason: REASONS[j.error] ?? REASONS.fetch_failed, title: j.title ?? "" });
          return;
        }
        const v: VideoRecord = { id, title: j.title ?? "", auto: !!j.auto, sentences: j.sentences, done: [], cursor: 0, addedAt: Date.now(), lastAt: Date.now() };
        save(v);
        setLoad({ state: "ready" });
      } catch {
        if (!dead) setLoad({ state: "paste", reason: REASONS.network, title: "" });
      }
    })();
    return () => {
      dead = true;
    };
  }, [id, save]);

  useEffect(() => {
    if (yt.ready) yt.setRate(tab === "watch" ? 1 : settings.rate);
  }, [yt.ready, yt.setRate, tab, settings.rate]);

  return (
    <div className="study">
      <div className="sticky">
        <div className="topbar">
          <Link href="/" className="btn ghost" aria-label="처음으로">←</Link>
          <div className="title grow">{rec?.title || (load.state === "paste" ? load.title : "") || "불러오는 중"}</div>
        </div>
        <div className="player"><div ref={yt.hostRef} /></div>
        {rec && load.state === "ready" && (
          <>
            <CaptionSlot />
            <nav className="tabs" role="tablist">
              {([["watch", "1", "전체 보기"], ["drill", "2", "따라하기"], ["expr", "3", "표현"]] as const).map(([k, n, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => { yt.pause(); setTab(k); }}>
                  <span className="n">{n}</span>{label}
                </button>
              ))}
            </nav>
          </>
        )}
      </div>

      {load.state === "loading" && <div className="body"><p className="muted">자막을 불러오는 중...</p></div>}
      {load.state === "paste" && (
        <PasteTranscript
          reason={load.reason}
          onDone={(sentences) => {
            save({ id, title: load.title, auto: false, sentences, done: [], cursor: 0, addedAt: Date.now(), lastAt: Date.now() });
            setLoad({ state: "ready" });
          }}
        />
      )}
      {rec && load.state === "ready" && (
        <>
          {tab === "watch" && <WatchTab rec={rec} yt={yt} settings={settings} setSettings={setSettings} onPick={(i) => { save({ ...rec, cursor: i }); setTab("drill"); }} />}
          {tab === "drill" && <DrillTab rec={rec} save={save} yt={yt} settings={settings} setSettings={setSettings} />}
          {tab === "expr" && <ExprTab rec={rec} save={save} yt={yt} />}
        </>
      )}
    </div>
  );
}

/* ---------- 자막 영역: 탭마다 내용을 채워 넣는다 ---------- */
let setCaptionExternal: ((c: React.ReactNode) => void) | null = null;
function CaptionSlot() {
  const [c, setC] = useState<React.ReactNode>(null);
  useEffect(() => {
    setCaptionExternal = setC;
    return () => {
      setCaptionExternal = null;
    };
  }, []);
  return <div className="caption" aria-live="polite">{c}</div>;
}
function useCaption(node: React.ReactNode, deps: unknown[]) {
  useEffect(() => {
    setCaptionExternal?.(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

type YT = ReturnType<typeof useYouTube>;

/* ---------- 1. 전체 보기 ---------- */
function WatchTab({ rec, yt, settings, setSettings, onPick }: { rec: VideoRecord; yt: YT; settings: Settings; setSettings: (s: Settings) => void; onPick: (i: number) => void }) {
  const [cur, setCur] = useState(-1);
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const tr = rec.analysis?.translations ?? [];

  useEffect(() => {
    if (!yt.ready) return;
    const t = setInterval(() => {
      const now = yt.time();
      const k = rec.sentences.findIndex((s, i) => now >= s.start && now < (rec.sentences[i + 1]?.start ?? s.end + 1));
      setCur(k);
    }, 200);
    return () => clearInterval(t);
  }, [yt.ready, yt.time, rec.sentences]);

  useEffect(() => {
    if (!follow || cur < 0 || !yt.playing) return;
    listRef.current?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cur, follow, yt.playing]);

  const s = rec.sentences[cur];
  useCaption(
    s ? (
      <>
        <div className="en">{s.text}</div>
        {settings.showKo && tr[cur] && <div className="ko">{tr[cur]}</div>}
      </>
    ) : (
      <div className="hidden">재생하면 여기에 자막이 나와요</div>
    ),
    [cur, settings.showKo, tr.length],
  );

  const stats = useMemo(() => {
    const words = rec.sentences.reduce((n, x) => n + x.text.split(" ").length, 0);
    const speak = rec.sentences.reduce((n, x) => n + (x.end - x.start), 0);
    return { words, speak, wpm: Math.round(words / Math.max(1, speak / 60)) };
  }, [rec.sentences]);

  return (
    <div className="body">
      <div className="card" style={{ gap: 6 }}>
        <div className="row small" style={{ justifyContent: "space-between" }}>
          <span>문장 <b className="mono">{rec.sentences.length}</b></span>
          <span>단어 <b className="mono">{stats.words}</b></span>
          <span>말하는 시간 <b className="mono">{fmtTime(stats.speak)}</b></span>
          <span>분당 <b className="mono">{stats.wpm}</b>단어</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          먼저 끝까지 들으면서 자막을 읽어요. {stats.wpm >= 160 ? "말이 빠른 편이라 따라하기는 0.75배속으로 시작해 보세요." : stats.wpm < 120 ? "말이 느린 편이라 처음 시작하기 좋아요." : "보통 속도예요."}
          {rec.auto && " 자동 생성 자막이라 문장이 어색하게 나뉜 곳은 따라하기 탭에서 고칠 수 있어요."}
        </p>
      </div>
      <div className="toggles card">
        <label>한국어 번역 같이 보기{!tr.length && <span className="small muted"> (표현 탭에서 분석하면 생겨요)</span>}
          <input type="checkbox" checked={settings.showKo} onChange={(e) => setSettings({ ...settings, showKo: e.target.checked })} />
        </label>
        <label>재생 위치 따라 자동 스크롤<input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /></label>
      </div>
      <div className="lines" ref={listRef}>
        {rec.sentences.map((x) => (
          <button key={x.i} data-i={x.i} className={`line ${x.i === cur ? "now" : ""} ${rec.done.includes(x.i) ? "done" : ""}`} onClick={() => yt.seek(x.start)}>
            <span className="t">{fmtTime(x.start)}</span>
            <span>
              {x.text}
              {settings.showKo && tr[x.i] && <span className="ko">{tr[x.i]}</span>}
            </span>
          </button>
        ))}
      </div>
      <button className="btn primary big" onClick={() => onPick(cur >= 0 ? cur : rec.cursor)}>
        {cur >= 0 ? `${cur + 1}번 문장부터 따라하기` : "따라하기 시작"}
      </button>
    </div>
  );
}

/* ---------- 2. 따라하기 ---------- */
const PHASES = ["자막 보고 듣기", "따라 말하기", "자막 없이 듣기", "따라 말하기"];

function DrillTab({ rec, save, yt, settings, setSettings }: { rec: VideoRecord; save: (v: VideoRecord) => void; yt: YT; settings: Settings; setSettings: (s: Settings) => void }) {
  const i = Math.min(rec.cursor, rec.sentences.length - 1);
  const s = rec.sentences[i];
  const [phase, setPhase] = useState(-1); // -1 대기, 0~3 진행, 4 끝
  const [gap, setGap] = useState(0);
  const [editing, setEditing] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const recRef = useRef(rec);
  recRef.current = rec;
  const tr = rec.analysis?.translations?.[i];
  const tip = rec.analysis?.tips?.find((t) => t.sentence === i);

  const stop = useCallback(() => {
    ctl.current?.abort();
    ctl.current = null;
    yt.pause();
    setPhase(-1);
    setGap(0);
  }, [yt]);
  useEffect(() => () => ctl.current?.abort(), []);

  const go = useCallback((k: number) => {
    stop();
    const r = recRef.current;
    save({ ...r, cursor: Math.max(0, Math.min(r.sentences.length - 1, k)) });
  }, [save, stop]);

  const waitGap = async (sec: number, signal: AbortSignal) => {
    const t0 = Date.now();
    while (Date.now() - t0 < sec * 1000) {
      setGap((Date.now() - t0) / (sec * 1000));
      await sleep(50, signal);
    }
    setGap(0);
  };

  const run = useCallback(async (from: number) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    let k = from;
    try {
      for (;;) {
        const cur = recRef.current.sentences[k];
        if (!cur) break;
        const speak = (cur.end - cur.start) / settings.rate;
        const pause = speak * 1.15 + 0.8;
        setPhase(0);
        await yt.playSegment(cur.start, cur.end, c.signal);
        if (settings.repeatGap) { setPhase(1); await waitGap(pause, c.signal); }
        setPhase(2);
        await yt.playSegment(cur.start, cur.end, c.signal);
        if (settings.repeatGap) { setPhase(3); await waitGap(pause, c.signal); }
        setPhase(4);
        const r = recRef.current;
        const done = r.done.includes(k) ? r.done : [...r.done, k];
        const last = k >= r.sentences.length - 1;
        if (settings.autoNext && !last) {
          k += 1;
          save({ ...r, done, cursor: k });
          await sleep(500, c.signal);
          continue;
        }
        save({ ...r, done });
        break;
      }
    } catch {
      /* 멈춤 */
    } finally {
      if (ctl.current === c) ctl.current = null;
    }
  }, [settings.rate, settings.repeatGap, settings.autoNext, save, yt]);

  const playOnce = async () => {
    stop();
    const c = new AbortController();
    ctl.current = c;
    try { await yt.playSegment(s.start, s.end, c.signal); } catch {}
  };

  const running = phase >= 0 && phase < 4;
  const hideText = phase === 2 || phase === 3;

  useCaption(
    s ? (
      hideText ? (
        <div className="hidden">{phase === 2 ? "자막 없이 들어보세요" : "방금 들은 대로 따라 말해보세요"}</div>
      ) : (
        <>
          <div className="en">{s.text}</div>
          {settings.showKo && tr && <div className="ko">{tr}</div>}
        </>
      )
    ) : null,
    [i, hideText, phase, settings.showKo, tr, s?.text],
  );

  if (!s) return <div className="body"><p className="muted">문장이 없어요.</p></div>;
  const pct = (rec.done.length / rec.sentences.length) * 100;

  return (
    <div className="body">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="small muted">완료 <span className="mono">{rec.done.length}/{rec.sentences.length}</span></span>
          <span className="small muted mono">{fmtTime(s.start)} – {fmtTime(s.end)}</span>
        </div>
        <div className="prog"><i style={{ width: `${pct}%` }} /></div>
        <div className="steps">
          {PHASES.map((p, k) => (
            <span key={k} className={phase === k ? "on" : phase > k ? "past" : ""}>
              {k === 1 || k === 3 ? (settings.repeatGap ? p : "—") : p}
            </span>
          ))}
        </div>
        <div className="gapbar" aria-hidden><i style={{ width: `${gap * 100}%` }} /></div>
        {running ? (
          <button className="btn big" onClick={stop}>멈추기</button>
        ) : (
          <button className="btn primary big" onClick={() => run(i)} disabled={!yt.ready}>
            {phase === 4 ? "이 문장 한 번 더" : "▶ 자막 ON → OFF 두 번 듣고 따라하기"}
          </button>
        )}
        <div className="nav">
          <button className="btn" onClick={() => go(i - 1)} disabled={i === 0}>← 이전</button>
          <div className="counter">{i + 1} / {rec.sentences.length}{rec.done.includes(i) && " ✓"}</div>
          <button className="btn" onClick={() => go(i + 1)} disabled={i >= rec.sentences.length - 1}>다음 →</button>
        </div>
        <div className="row">
          <button className="btn" onClick={playOnce} disabled={!yt.ready}>원본 한 번만</button>
          <button className="btn" onClick={() => setEditing((e) => !e)}>{editing ? "편집 닫기" : "문장 나누기·합치기"}</button>
        </div>
      </div>

      {tip && (
        <div className="notice">
          <b>발음 포인트</b> · {tip.focus}
          <div className="small">{tip.tip}</div>
        </div>
      )}

      {editing && (
        <div className="card">
          <div className="small muted">나눌 위치의 단어를 누르면 그 단어부터 새 문장이 돼요.</div>
          <div className="chips">
            {s.text.split(" ").map((w, k) => (
              <button key={k} className="chip" disabled={k === 0} onClick={() => { stop(); save(splitAt(rec, i, k)); }}>{w}</button>
            ))}
          </div>
          <div className="row">
            <button className="btn" disabled={i === 0} onClick={() => { stop(); save(mergeWithPrev(rec, i)); }}>앞 문장과 합치기</button>
            <button className="btn" disabled={i >= rec.sentences.length - 1} onClick={() => { stop(); save({ ...mergeWithPrev(rec, i + 1), cursor: i }); }}>다음 문장과 합치기</button>
          </div>
        </div>
      )}

      <Recorder videoId={rec.id} i={i} onOriginal={playOnce} />

      <div className="toggles card">
        <label>재생 속도
          <span className="chips">
            {[0.75, 0.9, 1].map((r) => (
              <button key={r} className={`chip ${settings.rate === r ? "on" : ""}`} onClick={() => setSettings({ ...settings, rate: r })}>{r}x</button>
            ))}
          </span>
        </label>
        <label>듣고 나서 따라 말할 시간 주기<input type="checkbox" checked={settings.repeatGap} onChange={(e) => setSettings({ ...settings, repeatGap: e.target.checked })} /></label>
        <label>끝나면 다음 문장 자동 시작<input type="checkbox" checked={settings.autoNext} onChange={(e) => setSettings({ ...settings, autoNext: e.target.checked })} /></label>
        <label>한국어 번역 보기<input type="checkbox" checked={settings.showKo} onChange={(e) => setSettings({ ...settings, showKo: e.target.checked })} /></label>
      </div>
    </div>
  );
}

function Recorder({ videoId, i, onOriginal }: { videoId: string; i: number; onOriginal: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "rec" | "denied">("idle");
  const [supported, setSupported] = useState(true);
  const handle = useRef<{ stop: () => Promise<Blob> } | null>(null);

  useEffect(() => setSupported(canRecord()), []);
  useEffect(() => {
    let u: string | null = null;
    let dead = false;
    recordings.get(videoId, i).then((b) => {
      if (dead) return;
      u = b ? URL.createObjectURL(b) : null;
      setUrl(u);
    });
    return () => {
      dead = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [videoId, i]);

  const toggle = async () => {
    if (state === "rec") {
      const b = await handle.current!.stop();
      handle.current = null;
      setState("idle");
      await recordings.put(videoId, i, b);
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(b);
      });
      return;
    }
    try {
      handle.current = await startRecording();
      setState("rec");
    } catch {
      setState("denied");
    }
  };

  if (!supported) return null;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b style={{ fontSize: 14 }}>내 목소리 비교</b>
        <button className={`btn ${state === "rec" ? "" : "rec"}`} onClick={toggle}>{state === "rec" ? "■ 녹음 끝" : "● 녹음"}</button>
      </div>
      {state === "denied" && <div className="err">마이크 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 마이크를 허용해 주세요.</div>}
      {url ? (
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <button className="btn" onClick={onOriginal}>원본</button>
          <audio controls src={url} style={{ width: "100%", height: 36 }} />
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>따라 말한 걸 녹음해서 원본과 번갈아 들어보세요. 문장마다 마지막 녹음 1개가 이 기기에 저장돼요.</p>
      )}
    </div>
  );
}

/* ---------- 3. 표현 ---------- */
function ExprTab({ rec, save, yt }: { rec: VideoRecord; save: (v: VideoRecord) => void; yt: YT }) {
  const [apiOn, setApiOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [paste, setPaste] = useState("");
  const [copied, setCopied] = useState("");
  const [, bump] = useState(0);
  const total = rec.sentences.length;
  const nChunks = Math.ceil(total / CHUNK);
  const [chunk, setChunk] = useState(() => Math.min(nChunks - 1, Math.floor(rec.cursor / CHUNK)));

  useEffect(() => {
    fetch("/api/analyze").then((r) => r.json()).then((j) => setApiOn(!!j.enabled)).catch(() => setApiOn(false));
  }, []);
  useCaption(<div className="hidden">표현 카드의 문장을 누르면 그 부분이 재생돼요</div>, []);

  const a = rec.analysis;
  const doneChunks = a ? a.chunks ?? [0] : [];
  const part = useMemo(() => rec.sentences.slice(chunk * CHUNK, chunk * CHUNK + CHUNK), [rec.sentences, chunk]);
  const prompt = useMemo(() => buildPrompt(rec.title, part), [rec.title, part]);
  const apply = (next: Analysis) => {
    save({ ...rec, analysis: mergeAnalysis(rec.analysis, next, chunk, total) });
    setPaste("");
  };
  const range = (c: number) => {
    const s0 = rec.sentences[c * CHUNK];
    const s1 = rec.sentences[Math.min(total, c * CHUNK + CHUNK) - 1];
    return `${fmtTime(s0.start)}–${fmtTime(s1.end)}`;
  };

  const analyze = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: rec.title, sentences: part.map(({ i, text }) => ({ i, text })) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      apply(j);
    } catch (e) {
      const c = (e as Error).message;
      setErr(c === "rate_limited" ? "요청이 많아요. 1분 뒤 다시 눌러주세요." : c === "bad_key" ? "API 키가 맞지 않아요. Vercel 환경변수를 확인해 주세요." : "분석에 실패했어요. 다시 눌러주세요.");
    }
    setBusy(false);
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      setCopied("복사가 안 되면 길게 눌러 직접 선택해 주세요");
    }
  };

  const src = (e: Expression) => rec.sentences[e.sentence];
  const exprs = a?.expressions ?? [];
  const chunkDone = doneChunks.includes(chunk);

  return (
    <div className="body">
      <div className="card">
        <h2 style={{ fontSize: 17 }}>쓸 만한 표현 뽑기</h2>
        <p className="small muted" style={{ margin: 0 }}>
          자주 쓰는 표현, 활용 패턴, 연계 표현, 발음 포인트, 문장별 번역을 만들어요.
          {nChunks > 1 && ` 영상이 길어서 ${CHUNK}문장씩 나눠 분석해요. 지금 연습하는 구간부터 해보세요.`}
        </p>
        {nChunks > 1 && (
          <div className="chips">
            {Array.from({ length: nChunks }, (_, c) => (
              <button key={c} className={`chip ${c === chunk ? "on" : ""}`} onClick={() => { setChunk(c); setErr(""); }}>
                <span className="mono">{range(c)}</span>{doneChunks.includes(c) && " ✓"}
              </button>
            ))}
          </div>
        )}
        {chunkDone ? (
          <div className="small muted">이 구간은 분석했어요. 아래 목록에 있어요.</div>
        ) : apiOn ? (
          <button className="btn primary big" onClick={analyze} disabled={busy}>
            {busy ? "분석 중... (30초~1분)" : nChunks > 1 ? `${chunk * CHUNK + 1}~${Math.min(total, chunk * CHUNK + CHUNK)}번 문장 분석` : "표현 뽑기"}
          </button>
        ) : null}
        {err && <div className="err">{err}</div>}
      </div>

      {apiOn === false && !chunkDone && (
        <div className="card">
          <b style={{ fontSize: 14 }}>API 키 없이 쓰는 방법</b>
          <ol className="howto">
            <li>프롬프트를 복사해요.</li>
            <li><a href="https://claude.ai/new" target="_blank" rel="noopener">Claude</a>나 ChatGPT 새 대화에 붙여넣어요.</li>
            <li>받은 답을 통째로 복사해서 아래 칸에 붙여넣어요.</li>
          </ol>
          <button className="btn" onClick={() => copy(prompt, "프롬프트 복사됨")}>프롬프트 복사</button>
          <textarea className="textarea" placeholder="AI 답변을 여기에 붙여넣기" value={paste} onChange={(e) => { setPaste(e.target.value); setErr(""); }} aria-label="AI 답변" />
          <button className="btn primary" disabled={!paste.trim()} onClick={() => {
            const p = parseAnalysis(paste);
            if (!p) return setErr("답변에서 결과를 찾지 못했어요. 답변 전체를 복사했는지 확인해 주세요.");
            apply(p);
          }}>불러오기</button>
        </div>
      )}
      {copied && <div className="notice">{copied}</div>}

      {exprs.length > 0 && (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="small muted">표현 {exprs.length}개 · ☆ 누르면 내 표현에 저장</span>
          <button className="btn" onClick={() => copy(exprs.map((e) => toPlatformFormat(e, src(e)?.text)).join("\n\n"), "전체 복사됨")}>전체 복사</button>
        </div>
      )}
      {exprs.map((e, k) => {
        const s = src(e);
        const on = store.isSaved(rec.id, e.phrase);
        return (
          <article key={k} className="expr">
            <div className="head">
              <div>
                <h3>{e.phrase}</h3>
                <div className="meaning">{e.meaning}</div>
              </div>
              <button className={`star ${on ? "on" : ""}`} aria-label={on ? "저장 취소" : "내 표현에 저장"} onClick={() => { store.toggleSaved(e, rec.id, s?.text ?? ""); bump((n) => n + 1); }}>{on ? "★" : "☆"}</button>
            </div>
            {s && (
              <button className="src" onClick={() => yt.playSegment(s.start, s.end).catch(() => {})}>
                <small>영상 속 문장 ▶ {fmtTime(s.start)}</small>{s.text}
              </button>
            )}
            {e.pattern && <div className="pattern">{e.pattern}</div>}
            {e.why && <div className="small muted">{e.why}</div>}
            {e.examples.length > 0 && (<><div className="lab">예문</div><ul>{e.examples.map((x, j) => <li key={j}>{x}</li>)}</ul></>)}
            {e.collocations.length > 0 && (<><div className="lab">자주 같이 쓰는 말</div><div className="chips">{e.collocations.map((x, j) => <span key={j} className="chip">{x}</span>)}</div></>)}
            {e.related.length > 0 && (
              <>
                <div className="lab">연계 표현</div>
                <div className="rel">{e.related.map((r, j) => <div key={j}><b>{r.phrase}</b> {r.note && <span>· {r.note}</span>}</div>)}</div>
              </>
            )}
            <div className="row"><button className="btn" onClick={() => copy(toPlatformFormat(e, s?.text), `‘${e.phrase}’ 복사됨`)}>영어 플랫폼 형식으로 복사</button></div>
          </article>
        );
      })}
      {a?.tips && a.tips.length > 0 && (
        <div className="card">
          <b style={{ fontSize: 14 }}>발음 포인트</b>
          {a.tips.map((t, k) => {
            const s = rec.sentences[t.sentence];
            return (
              <button key={k} className="line" style={{ gridTemplateColumns: "1fr" }} onClick={() => s && yt.playSegment(s.start, s.end).catch(() => {})}>
                <span><b>{t.focus}</b> <span className="small muted">▶ {s ? fmtTime(s.start) : ""}</span><span className="ko">{t.tip}</span></span>
              </button>
            );
          })}
        </div>
      )}
      {a && <ResetButton onReset={() => save({ ...rec, analysis: undefined })} />}
    </div>
  );
}

function ResetButton({ onReset }: { onReset: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className="btn ghost" onClick={() => (armed ? onReset() : setArmed(true))}>
      {armed ? "한 번 더 누르면 번역·표현이 지워져요" : "분석 다시 하기"}
    </button>
  );
}

/* ---------- 자막 붙여넣기 ---------- */
function PasteTranscript({ reason, onDone }: { reason: string; onDone: (s: Sentence[]) => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const submit = () => {
    const cues = parsePastedTranscript(text);
    if (!cues.length) return setErr("시간 정보가 있는 자막을 찾지 못했어요. 타임스탬프(0:12 같은)가 함께 복사됐는지 확인해 주세요.");
    onDone(toSentences(cues));
  };
  return (
    <div className="body">
      <div className="err">{reason} 자막을 직접 붙여넣으면 바로 시작할 수 있어요.</div>
      <div className="card">
        <b style={{ fontSize: 14 }}>유튜브 스크립트 복사하는 법 (PC)</b>
        <ol className="howto">
          <li>유튜브에서 영상 설명란의 <b>더보기</b>를 눌러요.</li>
          <li>아래쪽 <b>스크립트 표시</b>를 눌러요.</li>
          <li>오른쪽에 나온 스크립트를 처음부터 끝까지 드래그해서 복사해요.</li>
        </ol>
        <p className="small muted" style={{ margin: 0 }}>SRT, VTT 자막 파일 내용을 붙여넣어도 돼요.</p>
        <textarea className="textarea" placeholder={"0:00\nHi everyone.\n0:03\nToday I'll walk you through..."} value={text} onChange={(e) => { setText(e.target.value); setErr(""); }} aria-label="자막 붙여넣기" />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" disabled={!text.trim()} onClick={submit}>문장으로 나누기</button>
      </div>
    </div>
  );
}
