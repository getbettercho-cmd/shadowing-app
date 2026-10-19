import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCaptionPayload, parsePastedTranscript, parseYouTubeId, toSentences } from "../lib/transcript.ts";

test("parseYouTubeId", () => {
  assert.equal(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ?si=abc"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeId("hello"), null);
  assert.equal(parseYouTubeId("https://shadowingenglish.com/ko/practice/joey-is-wearing-makeup-friends-vjpdPeVFW2M"), "vjpdPeVFW2M");
  assert.equal(parseYouTubeId("https://example.com/blog/how-to-learn-english"), null);
});

test("timedtext XML with entities, sentences across cues", () => {
  const xml = `<?xml version="1.0" encoding="utf-8" ?><transcript>
<text start="0.5" dur="2.1">Hi everyone, I&amp;#39;m a product</text>
<text start="2.6" dur="2.0">designer at a startup. Today I&#39;ll walk</text>
<text start="4.6" dur="2.4">you through my morning. [Music]</text>
<text start="7.5" dur="1.5">Let&#39;s get started!</text></transcript>`;
  const cues = parseCaptionPayload(xml);
  assert.equal(cues.length, 4);
  assert.equal(cues[0].text, "Hi everyone, I'm a product");
  assert.equal(cues[2].text, "you through my morning.");
  const s = toSentences(cues);
  assert.deepEqual(s.map((x) => x.text), [
    "Hi everyone, I'm a product designer at a startup.",
    "Today I'll walk you through my morning.",
    "Let's get started!",
  ]);
  assert.ok(s[0].start < 0.5 && s[0].end > 3.5 && s[0].end <= s[1].start + 0.25);
  assert.ok(s[2].start > 7 && s[2].end <= 9.5);
});

test("srv3 format", () => {
  const xml = `<timedtext format="3"><body><p t="1000" d="1500"><s>So</s><s t="300"> what</s></p><p t="2500" d="2000">do you do?</p></body></timedtext>`;
  const s = toSentences(parseCaptionPayload(xml));
  assert.equal(s.length, 1);
  assert.equal(s[0].text, "So what do you do?");
});

test("json3 format", () => {
  const j = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "I love this." }] }, { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: "\n" }] }, { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: "Me too." }] }] });
  assert.deepEqual(toSentences(parseCaptionPayload(j)).map((x) => x.text), ["I love this.", "Me too."]);
});

test("auto captions without punctuation split by pauses/length", () => {
  const xml = `<transcript>
<text start="0" dur="4">so today we&#39;re going to talk about</text>
<text start="2" dur="4">user research and why it matters</text>
<text start="5.5" dur="3">for every product team</text>
<text start="10" dur="3">first let&#39;s look at interviews</text></transcript>`;
  const s = toSentences(parseCaptionPayload(xml));
  assert.ok(s.length >= 2, JSON.stringify(s));
  assert.ok(s.every((x) => x.text.split(" ").length <= 14));
  assert.equal(s.map((x) => x.text).join(" "), "so today we're going to talk about user research and why it matters for every product team first let's look at interviews");
  assert.ok(s[s.length - 1].text.startsWith("first"));
});

test("pasted YouTube transcript (Korean UI, timestamp lines)", () => {
  const txt = `0:00
0초
Hi, I'm Jenny.
0:02
2초
Welcome back to my channel.
1:05
1분 5초
Let's dive in.`;
  const cues = parsePastedTranscript(txt);
  assert.equal(cues.length, 3);
  assert.equal(cues[2].start, 65);
  assert.deepEqual(toSentences(cues).map((x) => x.text), ["Hi, I'm Jenny.", "Welcome back to my channel.", "Let's dive in."]);
});

test("pasted inline timestamps", () => {
  const cues = parsePastedTranscript("0:01 Good morning.\n0:03 How are you?");
  assert.equal(cues.length, 2);
  assert.equal(cues[1].start, 3);
});

test("SRT and VTT", () => {
  const srt = `1\n00:00:01,000 --> 00:00:03,500\nHello there.\n\n2\n00:00:04,000 --> 00:00:06,000\nNice to meet\nyou.\n`;
  const c = parsePastedTranscript(srt);
  assert.equal(c.length, 2);
  assert.equal(c[1].text, "Nice to meet you.");
  const vtt = `WEBVTT\n\n00:01.000 --> 00:03.000\n<v Anna>Hi!\n\n00:03.500 --> 00:05.000\nBye.`;
  assert.deepEqual(parsePastedTranscript(vtt).map((x) => x.text), ["Hi!", "Bye."]);
});

test("abbreviations and numbers don't split", () => {
  const xml = `<transcript><text start="0" dur="5">Dr. Kim said it grew 3.5 times in the U.S. market last year.</text><text start="5" dur="2">Wow.</text></transcript>`;
  const s = toSentences(parseCaptionPayload(xml));
  assert.equal(s.length, 2, JSON.stringify(s));
});

import { readFileSync } from "node:fs";
import { applyPunctuation, needsPunctuation, plainText } from "../lib/transcript.ts";

const friends = readFileSync(new URL("./fixture-friends-paste.txt", import.meta.url), "utf8");

test("pasted transcript with chapter titles and UI text", () => {
  const cues = parsePastedTranscript(friends);
  const all = cues.map((c) => c.text).join(" ");
  assert.ok(!/챕터|동기화|Thanksgiving plans/.test(all), all);
  assert.equal(cues[0].start, 1);
  assert.ok(cues.at(-1)!.text === "lunar");
});

test("unpunctuated transcript is detected and re-split with AI punctuation", () => {
  const sentences = toSentences(parsePastedTranscript(friends));
  assert.ok(needsPunctuation(sentences));
  const src = plainText(sentences);
  // AI가 문장부호를 찍고, 이름 철자를 고치고(Tribbiani), 단어 하나를 빼고(and), 하나를 더한(oh) 경우
  const ai = src
    .replace("hey hey hey and this from", "Hey, hey, hey. This from")
    .replace("Department are you wearing makeup yes I am", "Department! Are you wearing makeup? Yes, I am.")
    .replace("as of today I am officially Joey triani actor/model thank you", "As of today, I am officially Joey Tribbiani, actor/model. Thank you.")
    .replace("that's so funny cuz I was thinking you look more like Joey triani man/woman", "That's so funny, cuz I was thinking you look more like Joey Tribbiani, man/woman.")
    .replace("what were you modeling for", "What were you modeling for?")
    .replace("how can they do this to us huh", "How can they do this to us, huh? Oh,")
    .replace("lumps Joey you're going home right", "lumps. Joey, you're going home, right?");
  const out = applyPunctuation(sentences, ai);
  const texts = out.map((s) => s.text);
  assert.ok(texts.includes("Are you wearing makeup?"), texts.join("\n"));
  assert.ok(texts.includes("Yes, I am."), texts.join("\n"));
  assert.ok(texts.includes("What were you modeling for?"), texts.join("\n"));
  assert.ok(texts.some((t) => t.startsWith("As of today, I am officially Joey Triani,")), texts.join("\n"));
  assert.ok(texts.includes("Joey, you're going home, right?"), texts.join("\n"));
  assert.ok(texts.includes("And this from the cry for Health Department!"), texts.join("\n"));
  // 단어 순서와 개수는 원래 그대로
  assert.equal(out.map((s) => s.text).join(" ").replace(/[^a-z ]/gi, "").toLowerCase(), src.replace(/[^a-z ]/gi, "").toLowerCase());
  // 시간은 단조 증가, 'Are you wearing makeup?'은 0:01~0:19 사이
  const m = out.find((s) => s.text === "Are you wearing makeup?")!;
  assert.ok(m.start > 1 && m.end < 19, JSON.stringify(m));
  for (let k = 1; k < out.length; k++) assert.ok(out[k].start >= out[k - 1].start);
});
