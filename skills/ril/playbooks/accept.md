# Accept

## Checks

- Every plan verified or parked: `ril stage set accept`. Nothing proven at all: a worker writes the stop report, `ril stage set parked`, tell the person plainly; never done.
- An author writes the README (install, run, each feature with an example, what to do when it fails) BEFORE the final verification. `ril checkpoint`.
- Accept's adversarial review: a full review of the whole running product (`skills/ril/references/review.md`; prove reuses its reply), plus a scan of committed files for secrets, a committed secret being must-fix.
- Then `skills/ril/playbooks/prove.md` at that saved version: one fresh verifier per scenario not set aside, none that verified it before, installing and running it by the README.
- An author writes `.ril/docs/reports/final.md` from `templates/final-report.md`.
- `ril stage set done`.

## Evidence required for done

- The README existed at the verified saved version.
- `ril ledger summary`: every scenario proven at the current saved version, or "Accepted as unproven: <id>".
- `final.md` has its traceability table and "What is not covered".
- `ril stage set done` exited 0; or the project is parked with a stop report.
