role: verifier
unit: S1
goal: Prove scenario S1 on the current saved version and record the verdict.
inputs:
- .ril/docs/spec.md
- .ril/docs/verification/feature-map/S1.md
acceptance:
- Running the add command prints the new task and exits 0.
touch:
- .ril/evidence/S1/
rules:
- /opt/ril/templates/standing-rules.md
- /opt/ril/principles.md
ril: node /opt/ril/bin/ril
report: agent-report
stop:
- Stop when the verdict is recorded.
- Stop and report blocked if the kit cannot run.
