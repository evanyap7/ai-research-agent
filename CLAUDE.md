@AGENTS.md

## Deterministic check (backpressure)
Before saying a task is done, or committing, run `npm run check` (tsc, eslint, tests) and read the
output. If it fails, fix the cause; never skip hooks (`--no-verify`) or loosen the config to get
green. Report the actual result. The pre-commit hook (husky) runs the same command.
