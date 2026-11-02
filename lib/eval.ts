// Scoring for the claim-verification eval (npm run eval). The labels come from
// evals/claims.jsonl, which a person fills in by hand; nothing here invents them.

export const VERDICTS = ["VERIFIED", "REFUTED", "UNVERIFIED"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type LabelledClaim = { claim: string; label: Verdict; sources: string[]; note?: string };
export type Outcome = { label: Verdict; verdict: Verdict | null; truthRating: number | null };

const isVerdict = (v: unknown): v is Verdict => typeof v === "string" && (VERDICTS as readonly string[]).includes(v);

export function parseClaims(text: string): LabelledClaim[] {
  const rows: LabelledClaim[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    const where = `evals/claims.jsonl line ${i + 1}`;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`${where}: not valid JSON`);
    }
    const sources = row.sources;
    if (typeof row.claim !== "string" || !row.claim.trim()) throw new Error(`${where}: "claim" must be a non-empty string`);
    if (!isVerdict(row.label)) throw new Error(`${where}: "label" must be one of ${VERDICTS.join(", ")}`);
    if (!Array.isArray(sources) || sources.length === 0 || !sources.every((s) => typeof s === "string")) {
      throw new Error(`${where}: "sources" must list at least one URL you checked`);
    }
    rows.push({
      claim: row.claim,
      label: row.label,
      sources,
      ...(typeof row.note === "string" ? { note: row.note } : {}),
    });
  });
  return rows;
}

const BUCKETS = [
  { range: "0-25", lo: 0, hi: 25 },
  { range: "26-50", lo: 26, hi: 50 },
  { range: "51-74", lo: 51, hi: 74 },
  { range: "75-100", lo: 75, hi: 100 },
];

export function score(outcomes: Outcome[]) {
  const confusion = Object.fromEntries(
    VERDICTS.map((label) => [label, { VERIFIED: 0, REFUTED: 0, UNVERIFIED: 0, failed: 0 }]),
  ) as Record<Verdict, Record<Verdict | "failed", number>>;
  let correct = 0;
  let failed = 0;
  for (const o of outcomes) {
    if (o.verdict === null) {
      failed += 1;
      confusion[o.label].failed += 1;
      continue;
    }
    confusion[o.label][o.verdict] += 1;
    if (o.verdict === o.label) correct += 1;
  }
  // Calibration: only claims with a truth value (VERIFIED = true, REFUTED = false).
  const decided = outcomes.filter((o) => o.truthRating !== null && o.label !== "UNVERIFIED");
  const calibration = BUCKETS.map(({ range, lo, hi }) => {
    const inBucket = decided.filter((o) => {
      const r = Math.round(o.truthRating as number);
      return r >= lo && r <= hi;
    });
    const n = inBucket.length;
    return {
      range,
      n,
      meanRating: n ? inBucket.reduce((sum, o) => sum + (o.truthRating as number), 0) / n : null,
      shareTrue: n ? inBucket.filter((o) => o.label === "VERIFIED").length / n : null,
    };
  });
  return { n: outcomes.length, correct, failed, accuracy: outcomes.length ? correct / outcomes.length : null, confusion, calibration };
}
