---
name: ril-build
description: Builds one plan test first: an author splits it into tasks, then for each task a fresh tester writes failing tests and a fresh implementer makes them pass; the built code is reviewed and saved, then handed to ril-verify. Use when the project is in the build stage and a plan is not built yet.
---

# ril-build

## Outcome

One plan is built test first, one small task per agent: every task's tests were written from the acceptance alone and seen failing before any code, the code makes them pass without touching the proof kit, the plan's code has survived a full adversarial review, and the result is a saved version handed to `ril-verify`.

## Rules

**Which plan.** The next plan is the first `plan-<n>` in `ril unit list --kind plan` that is not `verified` or `parked`. Its plan file is `<project>/.ril/docs/plans/plan-<n>.md`. Every worker below is a fresh agent spawned through `ril-control`, one task per agent, never resumed. Plan units are `plan-<n>`, task units `plan-<n>-t<k>`. Wherever this skill says guided or autonomous, the mode is on the first line of `ril status --full`.

**Start.** `ril checkpoint`, then `ril unit set plan-<n> --state doing --checkpoint <the id it printed>`: the version the plan starts from, used later to see what the plan changed. For every plan after plan 1, first run the drift check in `ril-recipe`. A scenario that was set aside (status `parked` in `ril scenario list`) may still be listed in the plan: skip it; no task, test or proof is made for it.

**1. The tasks.** An `author` (unit `plan-<n>`) writes `<project>/.ril/docs/plans/plan-<n>-tasks.md`. `inputs`: the spec, the design, the plan file, `verify.md` and the feature maps of the plan's scenarios. Acceptance:
- Each task is a `### T<k>: <title>` block with `Scenarios:` (the scenario ids it serves), `Files:` (every product file it changes), `Tests:` (its acceptance-test files, under `tests/acceptance/`), `Run:` (the test command) and `Expected:` (the result that means done).
- Every scenario of the plan that is not set aside is served by at least one task. Each task has at most 5 files in `Files:` and one file in `Tests:` (T1 also lists the verify script); a bigger task is split.
- In plan 1, task T1 is the pilot: the thinnest piece that runs end to end. Its `Tests:` include the verify command's script named in `verify.md`, and the tester also writes the `scripts.verify` and `scripts.test` keys of `package.json`. T1's `Files:` include a project `.gitignore` listing at least `node_modules/`, so `ril checkpoint` never saves dependencies.
Review the tasks file with `ril-review` at the light level. Then add each task: `ril unit add plan-<n>-t<k> --kind task --parent plan-<n> --title "<its title>"`.

**2. The pilot.** In plan 1, T1 goes alone through the whole path before any other task starts: tests, build, review, `ril checkpoint` and `ril-verify` for the scenarios it serves (its first verifier runs the kit's Self-run). This proves the brief template, the proof kit and the task size. If the pilot shows one of them is wrong, fix that first (the tasks file through a fresh `author`, the kit through `ril-recipe`) and log why with `ril decision log --stage build --decision "<what changed>" --why "<what the pilot showed>"`.

**3. Each task: a tester, then an implementer.** Tasks run in parallel only when their `touch` sets are disjoint; otherwise one at a time.
- Protected entries: the acceptance tests in `tests/acceptance/` and the verify command's entries (its script, and only the `scripts.verify` and `scripts.test` keys of `package.json`). Only a tester changes them; dependencies and `bin` in `package.json` belong to the implementer and may change. Implementers and fixers never edit the `Protected:` paths.
- A `tester` (unit `plan-<n>-t<k>`) writes failing tests from the acceptance only; it never sees the implementation. `inputs`: the spec, the tasks file, `verify.md` and the task's feature maps; no product source. `touch`: the task's `Tests:` files (for T1 also `package.json`) and its own folder `<project>/.ril/agents/<id>/` for the red run's output. Acceptance, copied in: one test at least per acceptance line, through the real interface a person or caller uses; each test seen failing for the stated reason; no test that looks real but proves nothing: an expected value computed by the code under test, an assertion on data the test built itself, an assertion looser than the contract, an "it never called X" check with no positive case. Every test must fail when the behavior breaks and still pass when only internals change.
- Testers run only while no implementer or fixer is running. Take `ril checkpoint` before they start, and after their red runs `ril checkpoint --message "Tester version for <task units>"`, then store it on each task: `ril unit set plan-<n>-t<k> --checkpoint <id>`. A tester that repairs the kit (`ril-recipe`, `ril-verify`) is saved the same way, with the message alone.
- Then an `implementer` (same unit) makes them pass. `inputs`: the spec, the design, the tasks file, the tester's test files and its report. `touch`: the task's `Files:` and its own folder. Acceptance: every test passes, the whole suite passes (its output saved in its folder), simplest code that meets the spec, and no change to any `Protected:` entry.
- An implementer that reports a test as wrong goes to a fresh `tester` with that report in `inputs`; never let the implementer change the test.
- When the implementer is done: `ril unit set plan-<n>-t<k> --state built`, and `ril progress "<task title> built."`.

**4. Review the built code.** When every task of the plan is `built`: `ril checkpoint`, then `ril-review` on the plan's built code at the FULL level: the artifact is the files changed since the plan's starting version (`git diff --name-only <start> <now>`), unit `plan-<n>`. Its acceptance adds: the Protected entries are unchanged since the tester versions: `git log --format='%h %s' <now> -- <Protected paths>` lists only saved versions whose message starts `Tester version` (for `package.json`, a listed version counts only if it changed `scripts.verify` or `scripts.test`); any other change to them is must-fix. Must-fix findings go to a fresh `fixer` (unit `plan-<n>`): `inputs` the spec, `findings.md` and the task briefs; `touch` the root-cause files plus one new failing test in `tests/regression/`; acceptance: reproduce each must-fix with a failing test, then fix the root cause. `ril checkpoint` after each fix round, then `ril-review` again as it says.

**5. Hand over.** `ril checkpoint` (it prints the saved version), `ril progress "Plan <n> built."`, then start `ril-verify` for plan `<n>` with that saved version.

**Scope.** A task that needs a file outside its `touch`, a scenario outside the plan, or a change to the design is a scope change: stop that task. Autonomous mode: a fresh `author` changes the tasks file (or the plan) and you log the decision. Guided mode: ask the person first. Never widen a `touch` silently.

**When ril refuses** a command, read its message and its `Next:` line, do what it says, and run it again. Never use `--force` here without the person's yes.

**How you talk.** Plain words; say "saved version" and "step", never checkpoint or unit; every message ends with what happens next.

## Done when

- Every task unit of the plan is `built` (or parked by `ril-control` after two retries, and replanned around).
- The FULL review of the plan's code left no must-fix, or each one left is a decision starting `Accepted risk for <id>`.
- A `ril checkpoint` was taken after the last change, and `ril-verify` has started for the plan with that saved version.

## Involve the person when

- A scope change: guided mode always; autonomous mode only when it changes what the person was promised.
- A worker stopped before a risky or irreversible action.
- A review cap is reached with must-fix items left.

## Ask the CLI

- `ril unit list`, `ril unit add`, `ril unit set`: the plan and its tasks.
- `ril agent register`, `ril agent set`, `ril agent list`: through `ril-control`, for every worker.
- `ril checkpoint`: the saved version at the start, after each fix round and at the hand-over.
- `ril scenario list`: which scenarios are set aside.
- `ril decision log`, `ril progress`: what changed and why.
- `ril status --full`: the mode, on its first line.
