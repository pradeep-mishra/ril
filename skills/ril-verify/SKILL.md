---
name: ril-verify
description: Proves each scenario of a built plan on the real running program, through layered, independent checks, drives every failure through fresh fix rounds up to the cap, and in accept mode proves the whole product and writes the final report. Use after ril-build hands over a plan, when the project is in the accept stage, or when a stuck scenario needs the person.
---

# ril-verify

## Outcome

Every scenario of the plan is proven by independent evidence on the real program at the current saved version, or has stopped with a plain stop report and the person's choice. In accept mode the whole product is proven once more, the person has a README, a how-to-use guide and a final report saying honestly what is and is not covered, and the project is done.

## Rules

**What you are given.** A plan `<n>` and the saved version `V` from `ril-build`, or accept mode. The scenarios are those the plan lists (for plan 1's pilot, only those the pilot serves; the plan is marked verified only after all its tasks are built). A scenario that was set aside (`parked` in `ril scenario list`) may appear in a plan: skip it, never try to prove it, and list it in the final report as accepted without proof. Wherever this skill says guided or autonomous, the mode is on the first line of `ril status --full`.

**The layers.** Verification is layered and a scenario is proven only when every layer that applies passes at the current saved version. Layer 1 tests green: the kit's `verify` command passes. Layer 2 live proof: a `verifier` runs the real program and drives it the way a person would, by the recipe and the feature map, and saves evidence under `<project>/.ril/evidence/<scenario>/<V>/`. Layer 3 adversarial review: a fresh `reviewer` sees only the running program and the spec and tries to break it; any must-fix blocks. Layer 4 break-it pass: the verifier tries bad input, empty state, repeated actions and interruption, and records what happened. A property-based or generated-input test named in a feature map is part of layer 1. A gap is never a pass.

**Reviewer first.** Run `ril-review` at the FULL level on the running program at `V` (unit `plan-<n>`, the plan's scenarios named in its goal). Read its RESULT line, not STATUS: `must-fix: 0` is clean; must-fix above 0 goes to the fixer rules below as `ril-review` says, then `ril checkpoint` (a new `V`) and a fresh reviewer. At the cap, `ril-review` records each one left as `Accepted risk for <id>`. Keep the last reviewer's report path.

**Then the verifiers.** One fresh `verifier` per scenario, through `ril-control`, in parallel (their `touch` sets are disjoint). While `verify.md` says `Trusted: no`, start one verifier alone first, with `<project>/.ril/docs/verification/verify.md` added to its `touch` and the kit's `Self-run` in its acceptance (it runs it before its own scenario); start the rest only after it set `Trusted: yes (<V>)`, then log `ril decision log --stage <stage> --decision "Proof kit trusted at <V>" --why "<its Self-run evidence>"`. Until then only `blocked` can be recorded. Each brief:
- `inputs`: the spec, `verify.md`, the scenario's feature map, `<plugin folder>/recipes/cli/recipe.md`, the reviewer's report (the verifier's `inputs` must hold it), the testers' briefs of this plan, and the report format.
- `touch`: `<project>/.ril/evidence/<scenario>/<V>/` and its own `report.md`.
- `acceptance`, copied in:
  - Layers 1, 2 and 4 at saved version `V`, exactly as `verify.md` and the feature map say, with every command's real output in the evidence folder.
  - The verify command must print how many checks it ran: reject zero, or a drop from the last recorded count (`ril ledger summary`) unless the feature map shrank.
  - Fail the round if `git diff --name-only <the plan's start version> <V>` touches a `Protected:` path, unless the tester made the change (it is in a tester's `touch` in `inputs`).
  - `--review` from the reviewer's report: `clean` when its RESULT says `must-fix: 0`; `risks` only when `ril decision list` holds `Accepted risk for <scenario>`; otherwise `none`, and ril will refuse a pass.
  - Record its own verdict: `ril ledger record <scenario> <V> <proven-cli|failed|blocked> --evidence <file in the folder> --verifier <its id> --review <clean|risks|none> --checks <n>`. You never record it for them.
  - On `failed`, a failure report `failure.md` in the evidence folder: scenario, expected, actual, evidence path.
  - Every claim in its report is labelled measured, inferred or guess.

**Collect.** Read each verdict from RESULT; confirm a pass with `ril ledger check <scenario> <V>` and a failure with `ril scenario list` (status `failing`). A Self-run that failed (the kit stays `Trusted: no`, nothing but `blocked` is recorded): a weak check goes to a fresh `tester` (the only role that may change `Protected:` paths), a wrong step in `verify.md` goes to `ril-recipe`, and a program that does not start goes to the fix loop. A `blocked` result (the environment is broken) goes to `ril doctor` or the person, never to a fixer.

**Fix loop, for each `failed` scenario.** `ril round bump <scenario>`. Then a fresh `fixer` (unit: the scenario): `inputs` the failure report, the original brief of the implementer that built it, the previous fixer's report, the spec and the feature map; `touch` the root-cause files (the task's `Files:` plus any file a previous fixer named) and one new test file outside the `Protected:` paths, never a `Protected:` path. Acceptance: reproduce the defect with a failing test first, then fix the root cause; the whole suite passes; never lower a pass condition. A fixer that needs another file stops and names it; the next round's `touch` includes it. When it is done: `ril checkpoint`, then the reviewer and fresh verifiers again for every scenario of the plan at the new `V`.
- Two failures with the same cause (the same actual result, or the same cause named twice): spawn two fixers in parallel with different approaches, each named in its `goal`, in separate worktrees; each writes down its assumption and tests it before changing code. Keep the one whose failing test and `verify` pass (both: the smaller change), merge it, delete the other. It counts as one round.
- When a design question can be settled by running something, build a throwaway prototype instead of asking: a fixer for a diagnosis only, with `<project>/.ril/agents/<id>/prototype/` as its `touch`.

**At the cap.** When `ril round bump` exits 4, stop that scenario: no more fixers for it. Write `<project>/.ril/docs/reports/stop-<yyyymmdd-hhmmss>.md` from `<plugin folder>/templates/stop-report.md` (What works, What does not work yet, What was tried, Evidence, Your options), from the failure and fixer reports. Never lower a pass condition. Guided mode: `ril gate park stuck-<id> --question "<plain words, and where to read the stop report>" --options "simplify the scenario|change the approach|give a hint|stop" --default "<your pick>"`, ask it, `ril gate resolve`, then act: simplify (a fresh `author` rewrites it in the spec, `ril scenario update <id> --criterion "<new words>" --force "<their words>"`, `ril-recipe` for its map); change the approach (a fresh `author` changes the design or tasks, `ril round reset <id>`, back to `ril-build`); give a hint (add their words to the stop report, list it in the next fixer's `inputs`, `ril round reset <id>`); stop (`ril skip <id> --scenario --reason "<their words>"`). Autonomous mode: keep going on work that does not depend on the stuck scenario, `ril skip <id> --scenario --reason "stuck after the fix cap, see <stop report>"`, and list every stuck item in one final report.

**Plan verified.** When every scenario of the plan is proven at the same saved version or set aside: `ril unit set plan-<n> --state verified --checkpoint <V>`, the same for its tasks, `ril progress "Plan <n> proven."`. Then the next plan's `ril-build`; when no plan is left, `ril stage set accept` and accept mode.

**Accept mode.** When every scenario is proven or parked:
1. Fresh `author`s write `<project>/README.md` and a plain how-to-use guide, `<project>/docs/how-to-use.md` (install, every command with an example, what to do when it fails), from the spec and the tasks files. `ril checkpoint`: the saved version `V`.
2. The reviewer first, FULL, on the whole running program at `V`; its acceptance adds: scan the committed files for secrets and risky dependencies with whatever scanners exist, else search for key patterns (private keys, tokens, passwords with a value); a committed secret is must-fix.
3. A fresh, independent verifier that verified none of them before, briefed as in **Then the verifiers** (the diff taken from the last plan's saved version), proves every scenario that is not set aside at `V`, end to end, installing and running the product by the README on the person's machine and confirming it runs; one evidence folder per scenario in its `touch`. Failures go to the fix loop; then back to step 2.
4. A fresh `author` writes `<project>/.ril/docs/reports/final.md` from `ril scenario list`, `ril ledger summary`, `ril decision list`, the plans and the tasks files: the traceability table (scenario, design section, task, test, evidence); `## What is not covered` (what was verified, under which assumptions, what was left out, every scenario accepted without proof, every stuck item and its stop report); the decisions recovery or you made for the person.
5. `ril checkpoint`, then `ril ledger carry <scenario> <V> <new version>` for each proven scenario (only docs changed), then `ril stage set done`. Tell the person plainly it is done, how to run it, and where to read the final report.

**When ril refuses** a command, read its message and its `Next:` line, do what it says, and run it again. Never use `--force` without the person's yes.

**How you talk.** Plain words; say "saved version" and "proof", never checkpoint, ledger or verdict; never show ids, commands or raw output unless asked; every message ends with what happens next.

## Done when

- Per plan: every scenario it lists is proven at the plan's last saved version (`ril ledger check`) or set aside, and the plan unit is `verified`.
- A scenario that reached the fix cap has its stop report, and is set aside or waiting on the person's answer.
- Accept mode: `final.md` exists with its traceability table and `What is not covered`, and `ril stage set done` succeeded.

## Involve the person when

- A scenario reached the fix cap: guided mode asks with the stop report's options; autonomous mode lists it in the final report.
- A verifier is still `blocked` after `ril doctor --fix` and one retry.
- Anything risky, irreversible or paid, and a review cap reached with must-fix items left.

## Ask the CLI

- `ril ledger check`, `ril ledger summary`, `ril ledger carry`: the proofs (only a verifier runs `ril ledger record`).
- `ril round bump`, `ril round reset`: fix rounds and the cap.
- `ril agent register`, `ril agent set`, `ril agent list`: through `ril-control`, for every worker.
- `ril scenario list`, `ril scenario update`, `ril skip`: set-aside and stuck scenarios.
- `ril decision log`, `ril decision list`, `ril gate park`, `ril gate resolve`: trust, accepted risks and the person's choices.
- `ril checkpoint`, `ril unit set`, `ril stage set`, `ril progress`, `ril doctor`: saved versions, plan state, accept and done.
