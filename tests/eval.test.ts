import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClaims, score } from "../lib/eval.ts";

test("parses one labelled claim per line and skips blank lines", () => {
  const rows = parseClaims(
    '{"claim":"A","label":"VERIFIED","sources":["https://example.com/a"]}\n\n' +
      '{"claim":"B","label":"REFUTED","sources":["https://example.com/b"],"note":"checked"}\n',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].note, "checked");
});

test("rejects a row without a checked source or with an unknown label", () => {
  assert.throws(() => parseClaims('{"claim":"A","label":"VERIFIED","sources":[]}'), /line 1/);
  assert.throws(() => parseClaims('{"claim":"A","label":"TRUE","sources":["https://example.com"]}'), /line 1/);
});

test("scores verdict accuracy and a confusion matrix", () => {
  const s = score([
    { label: "VERIFIED", verdict: "VERIFIED", truthRating: 90 },
    { label: "REFUTED", verdict: "UNVERIFIED", truthRating: 40 },
    { label: "UNVERIFIED", verdict: "UNVERIFIED", truthRating: 50 },
    { label: "REFUTED", verdict: "REFUTED", truthRating: 10 },
  ]);
  assert.equal(s.n, 4);
  assert.equal(s.correct, 3);
  assert.equal(s.confusion.REFUTED.UNVERIFIED, 1);
  assert.equal(s.confusion.VERIFIED.VERIFIED, 1);
});

test("calibration buckets truthRating against the share of decided claims that were true", () => {
  const s = score([
    { label: "VERIFIED", verdict: "VERIFIED", truthRating: 80 },
    { label: "REFUTED", verdict: "VERIFIED", truthRating: 90 },
    { label: "REFUTED", verdict: "REFUTED", truthRating: 5 },
    { label: "UNVERIFIED", verdict: "UNVERIFIED", truthRating: 85 },
  ]);
  const top = s.calibration.find((b) => b.range === "75-100");
  assert.ok(top);
  assert.equal(top.n, 2); // UNVERIFIED labels have no truth value, so they are left out
  assert.equal(top.meanRating, 85);
  assert.equal(top.shareTrue, 0.5);
  assert.equal(s.calibration.find((b) => b.range === "0-25")?.shareTrue, 0);
});

test("a failed agent call counts as wrong, not skipped", () => {
  const s = score([{ label: "VERIFIED", verdict: null, truthRating: null }]);
  assert.equal(s.n, 1);
  assert.equal(s.correct, 0);
  assert.equal(s.failed, 1);
});
