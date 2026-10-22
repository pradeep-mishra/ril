# Shape

Goal: a reviewed spec of provable scenarios and an intake of the person's words, handed to design.

## Checks

- Wrong folder (home, or not where they want): ask where; they start a new session there.
- Ask the mode ALONE, before any playback: autonomous (my default: a few questions, then I decide; you see a summary before building) or guided (I also ask at each stage). Then `ril init --mode <mode> --name <name>` and `ril allowlist write --base --tool claude`.
- Play the idea back in two sentences; ask what is wrong; then one question at a time, default "my assumption": who it is for, must-haves, what is out, what they expect to see, their accounts.
- Intake, written by you, `.ril/docs/intake.md`: their words, preferences, your assumptions, what was cut and (autonomous) which stop-list actions are pre-approved.
- A screen a person looks at: ask "shape how it looks, or leave the look to me?" Leave = skip prototype.
- Cut to the core loop: the fewest scenarios that make it useful; the rest under `## Later`.
- An author writes `.ril/docs/spec.md` from `templates/spec.md`. Acceptance: each `### S<n>: <title>` has a Criterion a person checks by doing and seeing, and a Proof surface; what no run can show goes under `## Needs a person`; no placeholder.
- `ril scenario import .ril/docs/spec.md --check`; problems go to a fresh author. Each Needs-a-person item: `ril gate park needs-<n> ...`, asked now.
- Light review (`skills/ril/references/review.md`); guided: the person signs off.
- `ril scenario import .ril/docs/spec.md`, then `ril stage set design`.

## Evidence required for done

- `ril scenario list` shows every spec scenario; the intake is complete.
- The last review is clean or its risks accepted; guided: signed off.
- `ril stage get` says design.
