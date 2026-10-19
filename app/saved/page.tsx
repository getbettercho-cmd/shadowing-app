"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { store, type SavedExpr } from "@/lib/store";
import { toPlatformFormat } from "@/lib/prompt";

export default function Saved() {
  const [list, setList] = useState<SavedExpr[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => setList(store.saved()), []);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(label);
    } catch {
      setMsg("복사가 안 됐어요. 다시 눌러주세요.");
    }
    setTimeout(() => setMsg(""), 1800);
  };

  return (
    <main className="page">
      <header className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <Link href="/" className="small">← 처음으로</Link>
          <h1 style={{ fontSize: 22, marginTop: 4 }}>내 표현 {list.length}</h1>
        </div>
        {list.length > 0 && (
          <button className="btn" onClick={() => copy(list.map((e) => toPlatformFormat(e, e.source)).join("\n\n"), "전체 복사됨")}>전체 복사</button>
        )}
      </header>
      {msg && <div className="notice">{msg}</div>}
      {list.length === 0 && <p className="muted">영상의 표현 탭에서 ☆를 누르면 여기에 모여요.</p>}
      {list.map((e) => (
        <article key={e.videoId + e.phrase} className="expr">
          <div className="head">
            <div>
              <h3>{e.phrase}</h3>
              <div className="meaning">{e.meaning}</div>
            </div>
            <button className="star on" aria-label="저장 취소" onClick={() => { store.toggleSaved(e, e.videoId, e.source); setList(store.saved()); }}>★</button>
          </div>
          {e.source && <Link className="src" href={`/study/${e.videoId}`} style={{ textDecoration: "none", display: "block" }}><small>영상 속 문장</small>{e.source}</Link>}
          {e.pattern && <div className="pattern">{e.pattern}</div>}
          {e.related.length > 0 && <div className="rel">{e.related.map((r, j) => <div key={j}><b>{r.phrase}</b> {r.note && <span>· {r.note}</span>}</div>)}</div>}
          <div className="row"><button className="btn" onClick={() => copy(toPlatformFormat(e, e.source), `‘${e.phrase}’ 복사됨`)}>영어 플랫폼 형식으로 복사</button></div>
        </article>
      ))}
    </main>
  );
}
