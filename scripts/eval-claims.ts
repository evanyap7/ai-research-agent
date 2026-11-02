// Runs the labelled claims in evals/claims.jsonl through the app's claim mode
// and scores the verdicts. See evals/README.md.
import { readFileSync } from "node:fs";
import { parseClaims, score, VERDICTS, type Outcome, type Verdict } from "../lib/eval.ts";

const EVAL_URL = process.env.EVAL_URL ?? "http://localhost:3000/api/research";
const claimsPath = new URL("../evals/claims.jsonl", import.meta.url);

type Evidence = { claim: string; sourceIds: string[] };
type ClaimResponse = {
  result?: {
    verdict: Verdict;
    truthRating: number;
    supportingEvidence: Evidence[];
    contradictingEvidence: Evidence[];
  };
  sources?: { id: string; url: string }[];
  error?: string;
};

const rows = parseClaims(readFileSync(claimsPath, "utf8"));
if (rows.length === 0) {
  console.log("evals/claims.jsonl has no claims yet. Add labelled claims first (format in evals/README.md).");
  process.exit(1);
}

const outcomes: Outcome[] = [];
const spotCheck: string[] = [];

for (const [i, row] of rows.entries()) {
  let body: ClaimResponse;
  try {
    const res = await fetch(EVAL_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: row.claim, mode: "claim" }),
    });
    body = (await res.json()) as ClaimResponse;
  } catch (error) {
    body = { error: String(error) };
  }

  const result = body.result;
  if (!result) {
    console.log(`[${i + 1}/${rows.length}] FAILED  ${row.claim}\n    ${body.error ?? "no result"}`);
    outcomes.push({ label: row.label, verdict: null, truthRating: null });
    continue;
  }

  const mark = result.verdict === row.label ? "ok   " : "WRONG";
  console.log(`[${i + 1}/${rows.length}] ${mark} ${row.label} -> ${result.verdict} (${result.truthRating})  ${row.claim}`);
  outcomes.push({ label: row.label, verdict: result.verdict, truthRating: result.truthRating });

  const urls = new Map((body.sources ?? []).map((s) => [s.id, s.url]));
  const evidence = [
    ...result.supportingEvidence.map((e) => ({ ...e, side: "supports" })),
    ...result.contradictingEvidence.map((e) => ({ ...e, side: "contradicts" })),
  ];
  spotCheck.push(`\n## ${row.claim}\nMy label: ${row.label} (checked: ${row.sources.join(", ")})`);
  for (const e of evidence) {
    const cited = e.sourceIds.map((id) => urls.get(id) ?? `${id} (unknown id)`).join(", ");
    spotCheck.push(`- [${e.side}] ${e.claim}\n    cites: ${cited}`);
  }
}

const s = score(outcomes);
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

console.log(`\nAccuracy: ${s.correct}/${s.n} (${pct(s.accuracy)}); ${s.failed} request(s) failed and count as wrong.`);
console.log("\nConfusion (rows: my label, columns: app verdict)");
console.log(["label".padEnd(11), ...VERDICTS.map((v) => v.padStart(11)), "failed".padStart(8)].join(""));
for (const label of VERDICTS) {
  const r = s.confusion[label];
  console.log([label.padEnd(11), ...VERDICTS.map((v) => String(r[v]).padStart(11)), String(r.failed).padStart(8)].join(""));
}
console.log("\nCalibration (claims labelled VERIFIED or REFUTED)");
for (const b of s.calibration) {
  const mean = b.meanRating === null ? "n/a" : b.meanRating.toFixed(0);
  console.log(`  rating ${b.range.padEnd(7)} n=${String(b.n).padEnd(4)} mean rating ${mean.padEnd(4)} actually true ${pct(b.shareTrue)}`);
}
console.log("\nSpot-check: open each cited URL and confirm it says what the finding claims.");
console.log(spotCheck.join("\n"));
