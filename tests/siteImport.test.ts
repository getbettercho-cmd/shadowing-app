import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLessonHtml, alignSentences, isSiteLesson } from "../lib/siteImport.ts";
import { parsePastedTranscript } from "../lib/transcript.ts";

const html = readFileSync(new URL("./fixture-shadowingenglish.html", import.meta.url), "utf8");
const paste = readFileSync(new URL("./fixture-friends-paste.txt", import.meta.url), "utf8");

test("isSiteLesson", () => {
  assert.ok(isSiteLesson("https://shadowingenglish.com/ko/practice/joey-is-wearing-makeup-friends-vjpdPeVFW2M"));
  assert.ok(!isSiteLesson("https://youtu.be/vjpdPeVFW2M"));
  assert.ok(!isSiteLesson("hello"));
});

test("parse saved lesson page", () => {
  const l = parseLessonHtml(html);
  assert.equal(l.videoId, "vjpdPeVFW2M");
  assert.equal(l.title, "Joey Is Wearing Makeup | Friends");
  assert.equal(l.site, "shadowingenglish.com");
  assert.equal(l.sentences.length, 10);
  assert.equal(l.sentences[4], "Are you wearing makeup?");
  assert.equal(l.sentences[6], "As of today, I am officially Joey Tribbiani, actor slash model.");
  assert.equal(l.vocab.length, 13);
  assert.deepEqual(l.vocab[4], { word: "asthma", pos: "명사", ipa: "/ˈæzmə/", meaning: "천식" });
  assert.ok(l.pronunciation.some((p) => p.includes("gonna")), l.pronunciation.join(" | "));
  assert.ok(l.pronunciation.some((p) => p.includes("officially")));
  assert.match(l.summary, /문장 34개/);
});

test("align site sentences to caption times", () => {
  const cues = parsePastedTranscript(paste);
  const site = [
    "Hey, hey.", "Hey.", "Hey.", "And this from the crime for help department.", "Are you wearing makeup?", "Yes, I am.",
    "As of today, I am officially Joey Tribbiani, actor slash model.", "Thank you.",
    "That's so funny, because I was thinking you look more like Joey Tribbiani, man slash woman.",
    "What were you modeling for?", "Well, you know those posters for the City Free Clinic?",
  ];
  const s = alignSentences(cues, site);
  assert.equal(s.length, site.length);
  assert.equal(s[4].text, "Are you wearing makeup?");
  // 'Are you wearing'은 0:01 줄 끝, 'makeup'은 0:11 줄 시작
  assert.ok(s[4].start > 4 && s[4].start < 9, JSON.stringify(s[4]));
  assert.ok(s[4].end > 11 && s[4].end < 13.5, JSON.stringify(s[4]));
  assert.ok(s[5].start >= 11 && s[5].end < 15, JSON.stringify(s[5]));
  assert.ok(s[9].start > 19 && s[9].end < 27, JSON.stringify(s[9]));
  assert.ok(s[10].start > 23, JSON.stringify(s[10]));
  for (let k = 1; k < s.length; k++) {
    assert.ok(s[k].start > s[k - 1].start, `order ${k}`);
    assert.ok(s[k - 1].end <= s[k].start + 0.3, `overlap ${k}`);
    assert.ok(s[k].end > s[k].start);
  }
});
