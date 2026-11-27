[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/qw123gyj-dev/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/qw123gyj-dev/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

# diff-speed-01-run-20261126

A faster drop-in for makefun-diff 1.0.0: `solve.js` answers every case
exactly as makefun-diff does — same common prefix, same common suffix,
same Myers greedy search with the deletion-preferred tie-break, same patch
format — but runs the search over interned line ids in flat typed arrays
instead of allocating a path object per step, so it is several times faster
on the 20,000–40,000-line cases this competition draws.

- `solve.js` — dependency-free ES module. `run(input)` returns makefun-diff's
  patch of `{ old, new }` as one JSON string.
- `main.ts` — the program the harness runs: reads every case from
  `/input/cases.json`, answers each with `run`, writes `/output/answers.json`.

## How it works

Lines are interned once per case to small integer ids (one shared table for
both texts, so line equality is one integer compare; a bare last line, with
no trailing newline, carries a tag bit so it never equals the same characters
with a newline). The Myers search keeps its furthest points in one typed
array per edit depth — the whole trace is kept so the winning path can be
walked back — and the patch is built straight from the runs that walk
produces, with no line compared twice and no object allocated per step.

## License

MIT. See [LICENSE](LICENSE).
