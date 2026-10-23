# Prove

Goal: every scenario proven on the real product at the current saved version, by a verifier that did not build it, with a kit shown to fail. Kit workers get `skills/ril/references/proof-kit.md` in `inputs`.

## Write the kit (design, before code)
- An author writes `verify.md` and `.ril/docs/verification/feature-map/<id>.md` per scenario (set aside: its `Method:` line and why) from the spec and design.
- A reviewer attacks the kit against the spec first (`skills/ril/references/review.md`).

## Trust the kit (the pilot's first build)
- A verifier runs the kit (its one red run of real-app checks), then makes one deliberate break, in a throwaway copy, of what one check covers: that check fails; undone, it passes. Both runs saved under `.ril/evidence/kit/<saved version>/`.
- It runs `ril ledger selfrun <saved version> --break <file> --restored <file> --verifier <agent id>` and sets line 1 to `Trusted: yes (<saved version>)`.

## Drift check (after a stop, and each plan after the first)
- One verifier registered for the current plan unit reruns the kit's Doctor check, the verify command and every proven scenario's drive, recording nothing and changing nothing in the kit folder.
- Regression: a fresh verifier for that scenario records `failed`. Kit drift (a Doctor failure included): an author repairs it, then a new self-run. Stale test: a fresh tester.

## Verify (each plan, and accept)
- At saved version V, first a full review of the running product.
- One fresh verifier per scenario (`--unit <scenario>`), given the spec, `verify.md`, its feature map and the reviewer's reply. It runs the verify command, every path in the map and the break-it pass, saves evidence, and records `ril ledger record <scenario> <V> <proven-<method>|failed|blocked> --evidence <file> --verifier <agent id> --review <clean|risks|none> --checks <n>`.

## Fix loop
- `failed`: `ril round bump <scenario>`, a fresh fixer with the verdict, `ril checkpoint`, the reviewer, fresh verifiers for the plan's scenarios.
- Failed self-run: weak check to a tester, wrong kit step to an author, a product that will not start to a fixer.
- All proven or set aside: `ril unit set <id> --state verified --checkpoint <V>` for the plan and each task.

## Evidence required for done
- `ril scenario coverage` exits 0; the kit review is clean or its risks are accepted.
- A recorded self-run, and line 1 of `verify.md` names its version.
- `ril ledger check` prints VERIFIED for each scenario at V, from its own verifier.
- The plan is `verified`.
