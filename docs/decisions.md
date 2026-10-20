# Rules and what enforces them

This file keeps every rule RIL has and what actually enforces it. "CLI rail" means the `ril` command refuses.
"Test" means a test in this repo fails if the rule breaks. "Skill instruction only" means an agent is told to
follow it and nothing checks. "Nothing yet" means the rule is not enforced at all.
A rule that nothing enforces is a candidate for a check. A new rule is added only after the same failure shows up in
a real run, and the failure is named in the Run log below.

## The rules

| Rule | Enforced by |
|------|-------------|
| Rail 1: a scenario becomes `proven` only through a result recorded by a registered `verifier` agent at the current saved version, with an existing, non-empty evidence file inside the project, at least 1 check and a clean review (or risks after "Accepted risk for <id>") | CLI rail: `ril ledger record`. Tests: `tests/rails.test.mjs`, `tests/rails-bypass.test.mjs`, `tests/lifecycle.test.mjs` |
| While the proof kit's `verify.md` has no `Trusted: yes` line, only a `blocked` result is accepted | CLI rail: `ril ledger record`. Tests: `tests/rails.test.mjs`, `tests/lifecycle.test.mjs` |
| A pass moves to a later saved version only across test, doc or `.ril`-only changes | CLI rail: `ril ledger carry`. Tests: `tests/rails.test.mjs`, `tests/lifecycle.test.mjs` |
| Rail 2: the project reaches `done` only when every scenario is proven at the current saved version, or set aside with "Accepted as unproven: <id>"; zero scenarios is refused | CLI rail: `ril stage set done`. Tests: `tests/rails.test.mjs`, `tests/lifecycle.test.mjs` |
| Rail 3: a scenario's criterion and method are frozen once past `confirm`, unless `--force "<reason>"` (which is logged) | CLI rail: `ril scenario update`. Test: `tests/commands-state.test.mjs` |
| Rail 4: `ril round bump` past the cap (default 8) exits 4 and stores nothing | CLI rail: `ril round bump`. Tests: `tests/commands-state.test.mjs`, `tests/lifecycle.test.mjs` |
| `--force` never bypasses Rail 2 (`done`) or Rail 4 (the cap) | CLI rail: `ril stage set`, `ril round bump`. Tests: `tests/rails.test.mjs`, `tests/commands-state.test.mjs` |
| A bad agent brief is refused (exit 6) | CLI rail: `ril agent register`. Test: `tests/rails.test.mjs` |
| Every refusal prints a `Next:` line saying what to do | CLI: all commands. Tests: the `fails` helper in `tests/helpers/repo.mjs`, used by most test files |
| State is saved atomically, with a backup and a lock | Test: `tests/store.test.mjs`, `tests/lock.test.mjs` |
| Recovery: damaged state, stale lock, dead agents, orphaned units, proofs with missing evidence or a changed product | CLI: `ril doctor --fix`. Tests: `tests/recovery.test.mjs`, `tests/lifecycle.test.mjs` |
| A stuck item is set aside with a reason and the rest carries on | CLI: `ril skip`. Test: `tests/recovery.test.mjs` |
| A finished real run ends in a state that meets every acceptance condition | Test of the checker: `tests/e2e/check-state.test.mjs`. The real run itself is manual (`tests/e2e/RUNBOOK.md`) |
| Protected acceptance tests: implementers and fixers never edit them, only a tester does | Skill instruction only (`ril-build`, `ril-recipe`) |
| The seal: one global seal over the protected files; the last `Sealed` decision in `ril decision list` wins and is compared after each implementer or fixer | Skill instruction and controller bookkeeping with git (`ril-build`, `ril-verify`). No CLI rail |
| Workers never change state; only the verifier records a result | Skill instruction only (standing rules). The allowlist entry `Bash(ril *)` lets any agent run any `ril` command |
| The verifier is independent of the builders | Rail 1 needs a registered agent whose role is `verifier`, but anyone can register one. Skill instruction only |
| `ril-control` rules: only fresh workers with a full brief; never spawn an unregistered agent; never review a diff yourself; refuse roles outside the six | Skill instruction only (`ril-control`). The CLI refuses an unknown role at `ril agent register` |
| Every role reads the standing rules and `principles.md` first | Instruction only. The CLI checks only that the brief lists two rules paths |
| Retry by failure kind (cap or memory: smaller scope; network: as is; unknown: once; then park) | Skill instruction only (`ril-control`) |
| Light review for plans, full review for built code | Skill instruction only (`ril-review`) |
| The reviewer goes first and `--review` comes from its report | The CLI refuses `none` for a proven result (`ril ledger record`; `tests/rails.test.mjs`). The rest is skill instruction only (`ril-verify`) |
| Evidence is not changed after it is recorded | Nothing yet: evidence is checked to exist and be non-empty, but is not hashed |
| An acceptance ("Accepted risk", "Accepted as unproven") stays valid for as long as the project lives | Nothing yet: acceptances never expire, even if the scenario changes |
| Plain language to the person: one question at a time, no internals | Skill instruction only (`principles.md`, the stage skills) |
| Size limits: 8 skills, 120 lines per skill, 6 roles, 20 command groups, 300 lines per source file, no runtime dependencies | Test: `tests/budget.test.mjs` |
| Every `ril` command a skill or role names exists | Test: `tests/skills.test.mjs` |
| No shipped file names another plugin | Test: `tests/skills.test.mjs` for skills, roles and direction files. For docs and `tests/e2e` it is an author and reviewer restriction, not a test |
| Only the recipes that ship with RIL are trusted: preflight and allowlist refuse any other folder | CLI: `ril preflight`, `ril allowlist`. Test: `tests/preflight.test.mjs` |
| Risky or irreversible actions are never done silently | Skill instruction only (standing rule 7), plus the host's own permission prompts |

## Known limits

These rules are only an instruction to an agent, or nothing yet. A model that ignores them is not stopped by RIL.

- Protected acceptance tests and the seal: nothing in the CLI looks at them.
- Workers changing state: any agent can run any `ril` command.
- Verifier independence: anyone can register an agent with the role `verifier`.
- Evidence is not hashed, so a file can be changed after it was recorded.
- Acceptances never expire.
- The `ril-control` rules, the rules read, retry, light and full review, plain language to the person, and risky actions never done silently.
- Names of other plugins in docs and in `tests/e2e`.

## Run log

Filled in by the owner after each real run (see `tests/e2e/RUNBOOK.md`).

| Date | Run | What needed a human or stalled | What we changed |
|------|-----|--------------------------------|-----------------|
