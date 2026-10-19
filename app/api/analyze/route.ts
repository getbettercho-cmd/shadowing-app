import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildPrompt, parseAnalysis } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.ANTHROPIC_API_KEY) });
}

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "not_configured" }, { status: 501 });

  const body = (await req.json().catch(() => null)) as { title?: string; sentences?: { i: number; text: string }[] } | null;
  const sentences = (body?.sentences ?? []).filter((s) => typeof s?.text === "string").map((s) => ({ i: Number(s.i), text: s.text.slice(0, 400) }));
  if (!sentences.length) return NextResponse.json({ error: "empty" }, { status: 400 });

  const client = new Anthropic({ apiKey: key });
  try {
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: buildPrompt(String(body?.title ?? ""), sentences) }],
    });
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const parsed = parseAnalysis(text);
    if (!parsed) return NextResponse.json({ error: "bad_output" }, { status: 502 });
    return NextResponse.json(parsed);
  } catch (e) {
    const status = (e as { status?: number }).status;
    return NextResponse.json({ error: status === 429 ? "rate_limited" : status === 401 ? "bad_key" : "upstream" }, { status: 502 });
  }
}
