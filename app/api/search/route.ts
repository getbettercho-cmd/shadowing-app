import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isoToSec(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** 자막(사람이 단) 있는 짧은 영어 영상만 검색 */
export async function GET(req: Request) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return NextResponse.json({ error: "not_configured" }, { status: 501 });
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").slice(0, 120);
  if (!q) return NextResponse.json({ items: [] });
  const length = sp.get("len") === "medium" ? "medium" : "short"; // short: 4분 미만, medium: 4~20분

  const s = new URL("https://www.googleapis.com/youtube/v3/search");
  Object.entries({
    part: "snippet", type: "video", q, maxResults: "12", videoCaption: "closedCaption",
    videoEmbeddable: "true", relevanceLanguage: "en", safeSearch: "moderate", videoDuration: length, key,
  }).forEach(([k, v]) => s.searchParams.set(k, v));
  const sr = await fetch(s, { next: { revalidate: 3600 } });
  if (!sr.ok) return NextResponse.json({ error: "search_failed" }, { status: 502 });
  const sj = await sr.json();
  const ids: string[] = (sj.items ?? []).map((i: { id: { videoId: string } }) => i.id.videoId).filter(Boolean);
  if (!ids.length) return NextResponse.json({ items: [] });

  const v = new URL("https://www.googleapis.com/youtube/v3/videos");
  v.searchParams.set("part", "snippet,contentDetails");
  v.searchParams.set("id", ids.join(","));
  v.searchParams.set("key", key);
  const vr = await fetch(v, { next: { revalidate: 3600 } });
  const vj = vr.ok ? await vr.json() : { items: [] };

  type V = { id: string; snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string } } }; contentDetails: { duration: string } };
  const items = (vj.items as V[])
    .map((x) => ({
      id: x.id,
      title: x.snippet.title,
      channel: x.snippet.channelTitle,
      thumb: x.snippet.thumbnails.medium?.url ?? `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`,
      sec: isoToSec(x.contentDetails.duration),
    }))
    .filter((x) => x.sec >= 40);
  return NextResponse.json({ items });
}
