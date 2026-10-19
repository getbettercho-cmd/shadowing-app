import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildPunctuatePrompt } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 자동 자막에 문장부호·대문자만 넣는다 (단어는 바꾸지 않음) */
export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "not_configured" }, { status: 501 });
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = String(body?.text ?? "").slice(0, 12000);
  if (!text.trim()) return NextResponse.json({ error: "empty" }, { status: 400 });
  try {
    const msg = await new Anthropic({ apiKey: key }).messages.create({
      model: process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-5-5",
      max_tokens: 8000,
      messages: [{ role: "user", content: buildPunctuatePrompt(text) }],
    });
    const out = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    return NextResponse.json({ text: out });
  } catch (e) {
    const status = (e as { status?: number }).status;
    return NextResponse.json({ error: status === 429 ? "rate_limited" : status === 401 ? "bad_key" : "upstream" }, { status: 502 });
  }
}
