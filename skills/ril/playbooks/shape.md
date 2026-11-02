# Shape

## Checks

- Wrong folder (home, or not where they want): ask where; they start a new session there.
- Ask the mode ALONE, before any playback: autonomous (my default: a few questions, then I decide; you see a summary before building) or guided (I also ask at each stage). Then `ril init --mode <mode> --name <name>` and `ril allowlist write --base --tool claude`. If `ril` asks permission: `/permissions`, add `Bash(ril *)` at user level.
- Play the idea back in two sentences; ask what is wrong; then ask, default "my assumption": who it is for, must-haves, what is out, what they expect to see, their accounts.
- Intake, written by you, `.ril/docs/intake.md`: their words, preferences, your assumptions, what was cut and (autonomous) which stop-list actions are pre-approved.
- A screen a person looks at: ask "shape how it looks, or leave the look to me?" Leave = skip prototype.
- Fewest scenarios that make it useful; the rest under `## Later`.
- An author writes `.ril/docs/spec.md` from `templates/spec.md`. Acceptance: each `### S<n>: <title>` has a Criterion a person checks by doing and seeing, and a Proof surface; what no run can show goes under `## Needs a person`; no placeholder.
- `ril scenario import .ril/docs/spec.md --check`; problems go to a fresh author. Each Needs-a-person item: `ril gate park needs-<n> ...`, asked now.
- Spec review, light (`skills/ril/references/review.md`).
- `ril scenario import .ril/docs/spec.md`, then `ril stage set design`.

## Existing repo

- Needs git and a clean tree, else say the fix and stop. Work on branch `ril/<topic>`; never merge, push or rewrite history. Say once that `ril init` adds its pointer to CLAUDE.md and AGENTS.md.
- The intake adds: how it runs and is tested, what CLAUDE.md, README and CI demand (owner rules), the named area's paths, and one baseline test run, failures noted, never fixed unasked.
- Scenarios only for what you add or change; an old passing test that fails is a failed verdict. Ask first: migrations, dependency upgrades, CI, files outside the paths.
- Offer once: stronger checks on any existing part? Skip: never again.
- Strengthen, only when asked: criteria are intended behavior (their words, then docs, tests; they confirm); design without plans; `ril stage set accept --force "nothing to build"`. An existing test counts only if run now and the verifier judged it exercises the criterion; for the three costliest it also breaks the code, sees it fail, restores it with git. A failure: `ril stage set build --force "<why>"`, a fix plan, the usual rounds.

## Evidence required for done

- `ril scenario list` shows every spec scenario; the intake is complete.
- The last review is clean or its risks accepted; guided: signed off.
- `ril stage get` says design.
