# Claim-verification eval

`claims.jsonl` is empty on purpose. Its labels have to come from a person who
has read the sources, not from the model being tested, so nothing here is
filled in yet. The target is 40 to 60 energy and ESG claims that I label myself,
each with the sources I checked.

## Format

One JSON object per line:

```json
{"claim": "…", "label": "VERIFIED", "sources": ["https://…"], "note": "optional"}
```

- `label` is one of `VERIFIED`, `REFUTED` or `UNVERIFIED`, the same verdicts
  the app returns.
- `sources` lists the pages I used to decide the label. It must not be empty.
- `note` is optional, for example the figure or sentence that settled it.

## Run it

Start the app (`npm run dev`), then:

```bash
npm run eval                                  # posts each claim to http://localhost:3000/api/research
EVAL_URL=https://…/api/research npm run eval  # or another deployment
```

It reports:

- **Accuracy:** the share of claims where the app's verdict matches my label.
  A request that fails counts as wrong.
- **Confusion matrix:** my label against the app's verdict.
- **Calibration:** the app's truth rating grouped into ranges, against the
  share of claims in each range that are actually true. Claims I labelled
  `UNVERIFIED` have no truth value, so they are left out of this table.
- **Spot-check list:** each finding with the URLs it cites, so I can open them
  and check by hand that a citation says what the finding claims.
