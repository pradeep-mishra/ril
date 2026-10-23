# Accept

Goal: the whole product proven again at one saved version, with a README and an honest final report.

## Checks

- Every plan verified or parked: `ril stage set accept`. Nothing proven at all: a worker writes the stop report, `ril stage set parked`, tell the person plainly; never done.
- An author writes the README (install, run, each feature with an example, what to do when it fails) BEFORE the final verification. `ril checkpoint`.
- A full review of the whole running product (`skills/ril/references/review.md`; prove reuses this reviewer's reply); its acceptance adds a scan of committed files for secrets, and a committed secret is must-fix.
- Then `skills/ril/playbooks/prove.md` at that saved version: one fresh verifier per scenario not set aside, none that verified it before, installing and running it by the README. A failure goes through the fix loop, then back to the review.
- An author writes `.ril/docs/reports/final.md` from `templates/final-report.md`.
- `ril stage set done`.

## Evidence required for done

- The README existed at the verified saved version.
- `ril ledger summary`: every scenario proven at the current saved version, or "Accepted as unproven: <id>".
- `final.md` has its traceability table and "What is not covered".
- `ril stage set done` exited 0; or the project is parked with a stop report.
