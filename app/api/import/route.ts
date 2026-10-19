import { NextResponse } from "next/server";
import { isSiteLesson, parseLessonHtml } from "@/lib/siteImport";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 쉐도잉 사이트 레슨 페이지 하나를 읽어 문장·어휘·발음을 돌려준다 */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!isSiteLesson(url)) return NextResponse.json({ error: "unsupported" }, { status: 400 });
  try {
    const r = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
      cache: "no-store",
    });
    if (!r.ok) return NextResponse.json({ error: "fetch_failed", status: r.status }, { status: 502 });
    const lesson = parseLessonHtml(await r.text(), url);
    if (!lesson.sentences.length) return NextResponse.json({ error: "no_sentences" }, { status: 422 });
    return NextResponse.json(lesson);
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
