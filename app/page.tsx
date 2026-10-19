"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseYouTubeId, fmtTime, decodeEntities } from "@/lib/transcript";
import { store, type VideoRecord } from "@/lib/store";
import { isSiteLesson, parseLessonHtml } from "@/lib/siteImport";
import { putPendingLesson } from "@/lib/handoff";

const TOPICS: { label: string; q: string }[] = [
  { label: "UX·디자인", q: "UX designer day in the life" },
  { label: "포트폴리오", q: "UX case study walkthrough" },
  { label: "AI·테크", q: "how AI products are built explained" },
  { label: "회의 영어", q: "business English meeting phrases" },
  { label: "면접", q: "product designer interview questions answers" },
  { label: "스타트업", q: "startup founder story interview" },
  { label: "스몰토크", q: "English small talk at work" },
  { label: "일상 브이로그", q: "slow English daily vlog" },
];

type Item = { id: string; title: string; channel: string; thumb: string; sec: number };
const ytSearch = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIoAQ%253D%253D`;

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [urlErr, setUrlErr] = useState("");
  const [topic, setTopic] = useState(TOPICS[0]);
  const [custom, setCustom] = useState("");
  const [len, setLen] = useState<"short" | "medium">("short");
  const [items, setItems] = useState<Item[] | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "off" | "error">("idle");
  const [library, setLibrary] = useState<VideoRecord[]>([]);
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    setLibrary(Object.values(store.videos()).sort((a, b) => b.lastAt - a.lastAt));
    setSavedCount(store.saved().length);
  }, []);

  const q = custom.trim() || topic.q;
  useEffect(() => {
    let dead = false;
    setSearchState("loading");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&len=${len}`);
        if (dead) return;
        if (r.status === 501) return setSearchState("off");
        if (!r.ok) return setSearchState("error");
        setItems((await r.json()).items);
        setSearchState("idle");
      } catch {
        if (!dead) setSearchState("error");
      }
    }, custom ? 500 : 0);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [q, len, custom]);

  const open = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseYouTubeId(url);
    if (!id) return setUrlErr("유튜브 링크를 확인해 주세요. 예: https://youtu.be/xxxxxxxxxxx");
    router.push(isSiteLesson(url) ? `/study/${id}?src=${encodeURIComponent(url.trim())}` : `/study/${id}`);
  };

  return (
    <main className="page">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="eyebrow">SHADOWING LOOP</div>
          <h1 style={{ fontSize: 24 }}>오늘 따라 말할 영상</h1>
        </div>
        <Link href="/saved" className="btn">내 표현 {savedCount}</Link>
      </header>

      <form className="card" onSubmit={open}>
        <label htmlFor="url" className="eyebrow">영상 불러오기</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input id="url" className="input" inputMode="url" placeholder="유튜브 또는 쉐도잉 사이트 링크" value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlErr(""); }} />
          <button className="btn primary" type="submit">시작</button>
        </div>
        {urlErr && <div className="err">{urlErr}</div>}
        <p className="small muted" style={{ margin: 0 }}>
          쉐도잉 사이트(shadowingenglish.com) 레슨 링크를 넣으면 그 사이트의 문장 구분과 어휘·발음을 그대로 가져와요.
        </p>
        <label className="small" style={{ color: "var(--accent)", cursor: "pointer" }}>
          링크로 안 되면: 저장한 레슨 페이지 파일(.html) 올리기
          <input type="file" accept=".html,.htm,text/html" style={{ display: "none" }} onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const lesson = parseLessonHtml(await f.text());
            if (!lesson.videoId || !lesson.sentences.length) return setUrlErr("이 파일에서 레슨 문장을 찾지 못했어요. 레슨 페이지를 '웹페이지, 전체'로 저장했는지 확인해 주세요.");
            putPendingLesson(lesson);
            router.push(`/study/${lesson.videoId}`);
          }} />
        </label>
      </form>

      {library.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ fontSize: 17 }}>이어서 하기</h2>
          <div className="vlist">
            {library.slice(0, 5).map((v) => (
              <Link key={v.id} href={`/study/${v.id}`} className="vcard" style={{ color: "inherit", textDecoration: "none" }}>
                <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" />
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <b>{v.title || v.id}</b>
                  <div className="meta">문장 {v.done.length}/{v.sentences.length} · 표현 {v.analysis?.expressions.length ?? 0}개</div>
                  <div className="prog"><i style={{ width: `${(v.done.length / Math.max(1, v.sentences.length)) * 100}%` }} /></div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 17 }}>영상 추천</h2>
        <p className="small muted" style={{ margin: 0 }}>영어 자막이 직접 달린 영상만 보여줘요. 1~4분짜리로 시작하는 게 좋아요.</p>
        <div className="chips">
          {TOPICS.map((t) => (
            <button key={t.label} className={`chip ${t === topic && !custom ? "on" : ""}`} onClick={() => { setTopic(t); setCustom(""); }}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input className="input" placeholder="직접 검색 (영어로)" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="직접 검색" />
          <button className={`chip ${len === "short" ? "on" : ""}`} onClick={() => setLen("short")}>4분 미만</button>
          <button className={`chip ${len === "medium" ? "on" : ""}`} onClick={() => setLen("medium")}>4~20분</button>
        </div>

        {searchState === "loading" && <p className="small muted">찾는 중...</p>}
        {searchState === "error" && <div className="err">검색이 안 됐어요. 잠시 뒤 다시 시도하거나 아래 유튜브 검색을 이용하세요.</div>}
        {searchState === "off" && (
          <div className="notice">
            추천 검색은 YouTube API 키를 넣으면 켜져요. 지금은 유튜브에서 자막 필터를 켠 검색 결과로 열려요.
            <div style={{ marginTop: 8 }}>
              <a href={ytSearch(q)} target="_blank" rel="noopener">“{q}” 유튜브에서 보기 ↗</a>
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>마음에 드는 영상의 공유 링크를 위 칸에 붙여넣으면 돼요.</div>
          </div>
        )}
        {searchState === "idle" && items && (
          <div className="vlist">
            {items.length === 0 && <p className="small muted">자막 있는 영상이 없어요. 다른 주제를 골라보세요.</p>}
            {items.map((it) => (
              <button key={it.id} className="vcard" onClick={() => router.push(`/study/${it.id}`)}>
                <img src={it.thumb} alt="" />
                <div style={{ minWidth: 0 }}>
                  <b>{decodeEntities(it.title)}</b>
                  <div className="meta">{it.channel} · <span className="mono">{fmtTime(it.sec)}</span></div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
