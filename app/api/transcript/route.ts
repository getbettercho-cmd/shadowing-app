import { NextResponse } from "next/server";
import { parseCaptionPayload, toSentences } from "@/lib/transcript";

export const runtime = "nodejs";
export const maxDuration = 30;

type Track = { baseUrl: string; languageCode: string; kind?: string; name?: { simpleText?: string; runs?: { text: string }[] } };

const ANDROID = { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en", gl: "US" };
const UA_ANDROID = "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip";
const UA_WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

async function tracksFromInnertube(id: string): Promise<{ tracks: Track[]; blocked: boolean }> {
  const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA_ANDROID },
    body: JSON.stringify({ context: { client: ANDROID }, videoId: id }),
    cache: "no-store",
  });
  if (!r.ok) return { tracks: [], blocked: true };
  const j = await r.json();
  const status = j?.playabilityStatus?.status;
  return { tracks: j?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [], blocked: Boolean(status && status !== "OK") };
}

async function tracksFromWatchPage(id: string): Promise<Track[]> {
  const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
    headers: { "user-agent": UA_WEB, "accept-language": "en-US,en;q=0.9" },
    cache: "no-store",
  });
  if (!r.ok) return [];
  const html = await r.text();
  const m = html.match(/"captionTracks":(\[.*?\])\s*,\s*"audioTracks"/) || html.match(/"captionTracks":(\[.*?\])/);
  if (!m) return [];
  try {
    return JSON.parse(m[1]);
  } catch {
    return [];
  }
}

function pickTrack(tracks: Track[]): Track | undefined {
  const en = tracks.filter((t) => t.languageCode === "en" || t.languageCode.startsWith("en"));
  return en.find((t) => t.kind !== "asr") ?? en[0];
}

async function fetchCues(t: Track) {
  const base = t.baseUrl.replace(/&fmt=[^&]*/, "");
  for (const url of [base, base + "&fmt=json3", base + "&fmt=srv3"]) {
    const r = await fetch(url, { headers: { "user-agent": UA_WEB }, cache: "no-store" });
    if (!r.ok) continue;
    const cues = parseCaptionPayload(await r.text());
    if (cues.length) return cues;
  }
  return [];
}

async function title(id: string): Promise<string> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
    if (r.ok) return (await r.json()).title ?? "";
  } catch {}
  return "";
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("v") ?? "";
  if (!/^[\w-]{11}$/.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const titleP = title(id);
  let tracks: Track[] = [];
  let blocked = false;
  let failed = false;
  try {
    ({ tracks, blocked } = await tracksFromInnertube(id));
    if (!tracks.length) tracks = await tracksFromWatchPage(id);
  } catch {
    failed = true;
  }

  const track = pickTrack(tracks);
  if (!track) {
    return NextResponse.json(
      { error: tracks.length ? "no_english" : failed || blocked ? "fetch_failed" : "no_captions", title: await titleP, langs: tracks.map((t) => t.languageCode) },
      { status: 404 },
    );
  }
  let cues: Awaited<ReturnType<typeof fetchCues>> = [];
  try {
    cues = await fetchCues(track);
  } catch {}
  if (!cues.length) return NextResponse.json({ error: "fetch_failed", title: await titleP }, { status: 502 });

  return NextResponse.json({
    title: await titleP,
    auto: track.kind === "asr",
    sentences: toSentences(cues),
  });
}
