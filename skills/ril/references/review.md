# Review guide

A fresh reviewer, never the author, attacks the artifact.

## Who reviews what

- LIGHT, at most 2 rounds: spec, design, tool list, kit, plans, tasks, brief. "Must-fix only for a contradiction, an unprovable criterion or a missing case; everything else is noted; invent no risks."
- FULL, at most 3 rounds: built code and the running product. "Full adversarial effort, each finding reproduced where possible; must-fix is anything that breaks a promise, contradicts the spec, is unsafe or cannot be proven."

## Brief

- `inputs`: the artifact and the spec only (the intake when it reviews the spec), never the author's reply or earlier reviews.
- `acceptance`: the LIGHT or FULL line verbatim; one `- finding: <must-fix|noted> <scenario ids> <what breaks, where>` item per finding in the reply; RESULT starts `must-fix: N, noted: M`.
- Ask: Could this pass while the product is broken? What input, empty state, repeat or interruption breaks it? What promise is missed? Does each proof observe the criterion through the surface a person uses? What is too complex?

## Rounds

- Must-fix goes to a fresh author (documents) or fixer (code), then a fresh reviewer.
- At the cap (I8): the rest goes to one more fresh author or fixer with the findings, which fixes or disputes each. Only a disputed must-fix becomes an accepted risk: `ril decision log --stage <stage> --decision "Accepted risk for <id>: <finding>" --why "<the dispute>"`, one per affected scenario. Tell the person; guided asks first (`ril gate park review-<unit> ...`).

## Evidence required for done

- The last reply says `must-fix: 0`, or each must-fix left is a logged, disputed accepted risk the person knows.
- The caller has that reply's path (a verifier's `--review` needs it).
