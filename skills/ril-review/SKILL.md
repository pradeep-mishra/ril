---
name: ril-review
description: Has one artifact (the spec, the design, the plans, a plan's built code or the running program) attacked by a fresh reviewer that did not write it, and drives its must-fix findings to fixed or to a recorded, accepted risk. Use whenever a ril skill says to review something.
---

# ril-review

## Outcome

One artifact has been attacked by a reviewer that did not write it, every finding is triaged into must-fix or noted with a reason, and every must-fix finding is either fixed or, at the round cap, recorded as an accepted risk that the person has been told about plainly.

## Rules

**What you are given.** The calling skill names the artifact (its paths), its kind (spec, design, plan, built code, or the running program) and its unit (`shape`, `design`, `plan-<n>`, or a scenario id).

**How hard.** The reviewer sees only its brief, so copy exactly one of these two lines into its `acceptance`:
- LIGHT, for a spec, design or plan (at most 2 rounds): "must-fix only for a contradiction, an unprovable criterion or a missing case; everything else is noted; invent no risks."
- FULL, for built code and the running program (at most 3 rounds): "full adversarial effort: try to break it with edge inputs, misuse, empty state, repeated actions, interruption, security, needless complexity; reproduce each finding where you can; must-fix is anything that breaks a promise, contradicts the spec, is unsafe or cannot be proven."

**Spawn the reviewer.** Spawn a fresh `reviewer` through `ril-control`, for the unit you were given. Its brief:
- `inputs`: only the artifact and the spec (`<project>/.ril/docs/spec.md`), plus the report format. When the artifact is the spec itself, the intake (`<project>/.ril/docs/intake.md`, the person's own answers) takes the spec's place. It is never the author's notes, its report, or earlier reviews: the reviewer judges the work, not the story about it.
- `touch`: `<project>/.ril/agents/<id>/findings.md` and its own `report.md`.
- `goal`: try to break the artifact: missing cases, contradictions, needless complexity, security, anything unprovable.
- `acceptance`, copied in:
  - The LIGHT or FULL line above, word for word.
  - It triages its own findings by that line: each one must-fix or noted, with a one-line reason.
  - For built code and the running program, each must-fix names the scenario ids it affects (every id, when it affects all).
  - `findings.md` lists every finding with its tag, its reason and where it is; the report lists `findings.md` under EVIDENCE.
  - A finished review reports `STATUS: done` with RESULT starting `must-fix: N, noted: M`.

**Read the result.** When `ril-control` collects the reviewer, decide on RESULT, not STATUS. `STATUS: done` with `must-fix: 0` is clean. `STATUS: done` with must-fix above 0 is a fix round, never a retry. `STATUS: failed` or `blocked` follows `ril-control`'s retry and blocked rules, and does not count as a round. Log each round: `ril progress "Review of <artifact>, round <n>: must-fix <N>, noted <M>."`.

**Fix round.** Must-fix items go to a fresh agent, never a resumed one, with the artifact, the spec and `findings.md` in `inputs` and the artifact's paths in `touch`:
- A spec, design or plan: a fresh `author`, told to fix the must-fix items only. When the spec is the artifact, the fix author gets the intake in the spec's place as well.
- Built code or the running program: hand `findings.md` back to the owning skill (`ril-build` or `ril-verify`), which gives it to a fresh `fixer`.
Then a fresh reviewer, with the same `inputs` as the first one: never the fix report. Noted items are not fixed; they stay in `findings.md`.

**At the cap.** If must-fix items remain after the last allowed round (2 for light, 3 for full), stop fixing. For each one left (`--stage` is the current stage from `ril stage get`): `ril decision log --stage <stage> --decision "Accepted risk for <id or artifact>: <the finding in plain words>" --why "still open after <n> review rounds"`. For built code and the running program, log one decision per finding with the id of each scenario it affects, never a plan id, so the verifier of that scenario can record `--review risks`. Then tell the person plainly: what is still wrong, what it could cause, and what happens next. Guided mode (the mode is on the first line of `ril status --full`): ask before recording, with `ril gate park review-<unit> --question "<plain words>" --options "accept the risk|stop and change it" --default "accept the risk"`; on "stop and change it", hand back to the calling skill with the findings.

**Hand back.** Tell the calling skill: clean, or accepted at the cap; and the path of the last reviewer's report, which a verifier needs for `--review`.

**Never** review the artifact yourself, fix it yourself, or let the author and the reviewer be the same agent.

## Done when

- The last reviewer reported `STATUS: done` with `must-fix: 0`, or the cap was reached and every remaining must-fix is a decision starting `Accepted risk for` and the person has been told.
- Every reviewer, author and fixer you started is `done` or `failed` with a result (`ril agent list --active` shows none of them).
- The calling skill has the outcome and the last report's path.

## Involve the person when

- Only at the cap, when must-fix items remain: tell them plainly; in guided mode, ask first.

## Ask the CLI

- `ril agent register`, `ril agent set`, `ril agent list`: through `ril-control`, for the reviewer and the fixing agent.
- `ril decision log`: accepted risks at the cap.
- `ril gate park`, `ril gate resolve`: the guided-mode question at the cap.
- `ril progress`: one line per review round.
- `ril stage get`, `ril status --full`: the stage for the decision, and the mode.
