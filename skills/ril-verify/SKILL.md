---
name: ril-verify
description: Proves each scenario of a built plan on the real running program, through layered, independent checks, drives every failure through fresh fix rounds up to the cap, and in accept mode proves the whole product and writes the final report. Use after ril-build hands over a plan, when the project is in the accept stage, or when a stuck scenario needs the person.
---

# ril-verify

## Outcome

Every scenario of the plan is proven by independent evidence on the real program at the current saved version, or has stopped with a plain stop report and the person's choice. In accept mode the whole product is proven once more, the person has a README, a how-to-use guide and an honest final report, and the project is done.

## Rules

**What you are given.** A plan `<n>` and the saved version `V` from `ril-build`, or accept mode. The scenarios are those the plan lists (for plan 1's pilot, only those it serves). A scenario that was set aside (`parked` in `ril scenario list`) may appear in a plan: skip it, never try to prove it, and list it in the final report as accepted without proof. Wherever this skill says guided or autonomous, the mode is on the first line of `ril status --full`. Every worker here runs one at a time, through `ril-control`.

**The layers.** A scenario is proven only when every layer that applies passes at the current saved version. Layer 1 tests green: the kit's `verify` command passes (a property-based or generated-input test named in a feature map is part of it). Layer 2 live proof: a `verifier` drives the real program the way a person would. Layer 3 adversarial review: a fresh `reviewer` sees only the running program and the spec; any must-fix blocks. Layer 4 break-it pass: the verifier tries bad input, empty state, repeated actions and interruption. A gap is never a pass.

**Reviewer first.** Run `ril-review` at the FULL level on the running program at `V` (unit `plan-<n>`, the plan's scenarios named in its goal), as it says. Its must-fix loop is counted by `ril-review`'s own round cap and never `ril round bump`: must-fix items go to fixers as in the fix loop below, then `ril checkpoint` (a new `V`) and a fresh reviewer. At the cap it records `Accepted risk for <id>` per affected scenario. Start the verifiers only when the review is clean or capped; keep the last reviewer's report path.

**Then the verifiers.** One fresh `verifier` per scenario. While `verify.md` says `Trusted: no`, the first verifier also has `<project>/.ril/docs/verification/verify.md` in its `touch` and the kit's `Self-run` in its acceptance (before its own scenario); it sets `Trusted: yes (<V>)` on the first line of `verify.md`, then you log `ril decision log --stage <stage> --decision "Proof kit trusted at <V>" --why "<its Self-run evidence>"`. Until then only `blocked` can be recorded. Each brief:
- `inputs`: the spec, `verify.md`, the scenario's feature map, `<plugin folder>/recipes/cli/recipe.md`, the reviewer's report (the verifier's `inputs` must hold it), and the report format.
- `touch`: `<project>/.ril/evidence/<scenario>/<V>/` and its own `report.md`.
- `acceptance`, copied in:
  - Layers 1, 2 and 4 at `V`, exactly as `verify.md` and the feature map say, with every command's real output in the evidence folder.
  - The verify command prints how many checks it ran: reject zero, or a drop from the last recorded count (`ril ledger summary`) unless the feature map shrank.
  - If the acceptance tests or the sealed scripts changed since the seal (the T of the last `Sealed` decision in `ril decision list`: `git diff --quiet <T> <V> -- tests/acceptance`, and the six scripts verify, test, preverify, postverify, pretest and posttest in `git show <T>:package.json` and `git show <V>:package.json`), it records `blocked` and its report asks for the seal check.
  - `--review`: `clean` when the reviewer's report has no open must-fix that affects this scenario; `risks` when `Accepted risk for <this scenario's id>` is in `ril decision list`; otherwise `none`, and ril will refuse a pass.
  - Record its own verdict: `ril ledger record <scenario> <V> <proven-cli|failed|blocked> --evidence .ril/evidence/<scenario>/<V>/<file> --verifier <its id> --review <clean|risks|none> --checks <n>`. You never record it for them.
  - On `failed`, `failure.md` in the evidence folder: scenario, expected, actual, evidence path.
  - Every claim in its report is labelled measured, inferred or guess.

**Collect.** Read each verdict from RESULT; confirm a pass with `ril ledger check <scenario> <V>` and a failure with `ril scenario list` (status `failing`). A failed Self-run: a weak check goes to a fresh `tester` (sealed again as `ril-build` says), a wrong step in `verify.md` to `ril-recipe`, a program that does not start to the fix loop. A `blocked` that names a seal change: run the seal check from `ril-build` (after every implementer or fixer); a difference goes to a fresh `tester`, never a fixer or the implementer, then a new checkpoint and a new `Sealed at` decision. Any other `blocked` (the environment is broken) goes to `ril doctor` or the person, never to a fixer.

**Fix loop, one round at a time.** `ril round bump` counts only a verifier's `failed` verdict: for each `failed` scenario, `ril round bump <scenario>`, then a fresh `fixer` (unit: the scenario): `inputs` the failure report, the brief of the implementer that built it, the previous fixer's report, the spec and the feature map; `touch` the root-cause files (the task's `Files:` plus any file a previous fixer named) and one new test file in `tests/regression/`, never a `Protected:` path. Acceptance: reproduce the defect with a failing test first, then fix the root cause; the whole suite passes; never lower a pass condition. A fixer that needs another file stops and names it; the next round's `touch` includes it. Fixers run one at a time: after each fixer's seal check, one `ril checkpoint`; when the round's fixers are done, the reviewer and one fresh verifier per scenario of the plan, at that saved version, which is the latest saved version: a verdict counts only at the latest saved version. During a drift regression (`ril-recipe`), "the plan" is the regressed scenario's own plan (its tasks and their seals): fixers start for the regressed scenarios, verifiers run only for the regressed scenarios, and control then goes back to `ril-build` for the new plan, not the regressed one.
- After two failures with the same cause, the next fixer writes down its assumption and tests it before changing code; competing attempts are not used in this version.
- A design question that running something can settle: a fixer for a diagnosis only, building a throwaway prototype in `<project>/.ril/agents/<id>/prototype/` (its `touch`).

**At the cap.** When `ril round bump` exits 4, stop that scenario. Write `<project>/.ril/docs/reports/stop-<yyyymmdd-hhmmss>.md` from `<plugin folder>/templates/stop-report.md`, from the failure and fixer reports. Guided mode: `ril gate park stuck-<id> --question "<plain words, and where to read the stop report>" --options "simplify the scenario|change the approach|give a hint|stop" --default "<your pick>"`, ask it, `ril gate resolve`, then act: simplify (a fresh `author` rewrites it in the spec as `ril-shape` writes scenarios, `ril scenario update <id> --criterion "<new words>" --force "<their words>"`, `ril-recipe` for its map, back to `ril-build`); change the approach (a fresh `author` changes the design as `ril-design` says and the tasks, `ril round reset <id> --force "<the person's hint or approval>"`, back to `ril-build`); give a hint (add their words to the stop report and the next fixer's `inputs`, then the same `ril round reset`); stop (`ril skip <id> --scenario --reason "<their words>"`). Autonomous mode: `ril skip <id> --scenario --reason "stuck after the fix cap, see <stop report>"`, carry on with work that does not depend on it, and list it in the final report.

**Plan verified.** When every scenario of the plan is proven at the same saved version or set aside: `ril unit set plan-<n> --state verified --checkpoint <V>`, `ril unit set plan-<n>-t<k> --state verified` for its tasks, `ril progress "Plan <n> proven."`. After the pilot, back to `ril-build` for the rest of plan 1; after a proven plan, back to `ril-build` for the next; when no plan is left, `ril stage set accept`.

**Accept mode** starts when every plan is verified or parked and at least one scenario is proven. If nothing could be proven, stop: write the stop report, run `ril stage set parked` and tell the person plainly that nothing could be proven and why; never `done`. Otherwise:
1. Fresh `author`s write `<project>/README.md` and a plain how-to-use guide, `<project>/docs/how-to-use.md` (install, every command with an example, what to do when it fails), from the spec and the tasks files. `ril checkpoint`: the saved version `V`.
2. The reviewer first, FULL, on the whole running program at `V`; its acceptance adds: scan the committed files for secrets with `git grep -nIE` for key patterns (`BEGIN .*PRIVATE KEY`, `AKIA[0-9A-Z]{16}`, and `api_key`, `secret`, `token` or `password` followed by `=` or `:` and a value), and the dependencies with `npm audit` when it runs; a committed secret is must-fix.
3. Then one fresh verifier per scenario that is not set aside, none of which verified it before, briefed as above, proves it at `V` end to end, installing and running the product by the README on the person's machine. Failures go to the fix loop; then back to step 2.
4. A fresh `author` writes `<project>/.ril/docs/reports/final.md` from `<plugin folder>/templates/final-report.md`, using `ril scenario list`, `ril ledger summary`, `ril decision list`, the plans and the tasks files: the traceability table (scenario, design section, task, test, evidence) under What works; `## What is not covered` (what was verified, under which assumptions, what was left out, every scenario accepted without proof, every stuck item and its stop report); the decisions made for the person.
5. `ril checkpoint`, then `ril ledger carry <scenario> <V> <new version>` for each proven scenario (only docs changed), then `ril stage set done`. Tell the person plainly it is done, how to run it and where the final report is.

**When ril refuses** a command, read its message and its `Next:` line, do what it says, and run it again. Never use `--force` without the person's yes.

**How you talk.** Plain words; say "saved version" and "proof", never checkpoint, ledger or verdict; never show ids, commands or raw output unless asked; every message ends with what happens next.

## Done when

- Per plan: every scenario it lists is proven at the plan's last saved version (`ril ledger check`) or set aside, and the plan unit is `verified`.
- A scenario that reached the fix cap has its stop report, and is set aside or waiting on the person's answer.
- Accept mode: `final.md` exists with its traceability table and `What is not covered`, and `ril stage set done` succeeded; or nothing could be proven and the project is parked with a stop report.

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
- `ril checkpoint`, `ril unit set`, `ril stage set`, `ril progress`, `ril doctor`: saved versions, plan state, accept, done or parked.
