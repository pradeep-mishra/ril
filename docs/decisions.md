# Rules and what enforces them

This file keeps every rule RIL has and what actually enforces it. "CLI rail" means the `ril` command refuses.
"Test" means a test in this repo fails if the rule breaks. "Skill instruction only" means an agent is told to
follow it and nothing checks. "Nothing yet" means the rule is not enforced at all.
A rule that nothing enforces is a candidate for a check. A new rule is added only after the same failure shows up in
a real run, and the failure is named in the Run log below.

## The rules

| Rule | Enforced by |
|------|-------------|
| Rail 1: a scenario becomes `proven` only through a result recorded by a registered `verifier` agent at the current saved version, with a non-empty evidence file under `.ril/evidence/` (anywhere else is refused), at least 1 check and a clean review (or risks after "Accepted risk for <id>") | CLI rail: `ril ledger record`. Tests: `tests/rails.test.mjs`, `tests/rails-bypass.test.mjs`, `tests/lifecycle.test.mjs` |
| An untrusted kit, or no proof kit at all (`.ril/docs/verification/verify.md` missing), accepts only a `blocked` result. `Trusted: yes` counts only on the first line of `verify.md` | CLI rail: `ril ledger record`. Tests: `tests/rails.test.mjs`, `tests/review-fixes.test.mjs`, `tests/lifecycle.test.mjs` |
| A pass moves to a later saved version only across test, doc or `.ril`-only changes | CLI rail: `ril ledger carry`. Tests: `tests/rails.test.mjs`, `tests/lifecycle.test.mjs` |
| Rail 2: the project reaches `done` only when every scenario is proven at the current saved version, or set aside with "Accepted as unproven: <id>", and at least one scenario is proven; zero scenarios is refused. When nothing can be proven, `ril-verify` parks the project (`ril stage set parked`) | CLI rail: `ril stage set done`. Tests: `tests/rails.test.mjs`, `tests/rails-bypass.test.mjs`, `tests/lifecycle.test.mjs` |
| Rail 3: a scenario's criterion and method are frozen once past `confirm`, unless `--force "<reason>"` (which is logged) | CLI rail: `ril scenario update`. Test: `tests/commands-state.test.mjs` |
| Rail 4: `ril round bump` past the cap (default 8) exits 4 and stores nothing | CLI rail: `ril round bump`. Tests: `tests/commands-state.test.mjs`, `tests/lifecycle.test.mjs` |
| `round reset` needs `--force "<reason>"` and logs the reason as a decision | CLI rail: `ril round reset`. Test: `tests/commands-state.test.mjs` |
| `--force` never bypasses Rail 2 (`done`) or Rail 4 (the cap) | CLI rail: `ril stage set`, `ril round bump`. Tests: `tests/rails.test.mjs`, `tests/commands-state.test.mjs` |
| A bad agent brief is refused (exit 6) | CLI rail: `ril agent register`. Test: `tests/rails.test.mjs` |
| Every refusal prints a `Next:` line saying what to do | CLI: all commands. Tests: the `fails` helper in `tests/helpers/repo.mjs`, used by most test files |
| State is saved atomically, with a backup and a lock | Test: `tests/store.test.mjs`, `tests/lock.test.mjs` |
| Recovery: damaged state, stale lock, dead agents, orphaned units. Doctor demotes a proof only for missing or empty evidence or a lost saved version; a later change no longer demotes (accept mode re-verifies every scenario) | CLI: `ril doctor --fix`. Tests: `tests/recovery.test.mjs`, `tests/lifecycle.test.mjs` |
| The allowlist deny entries (`Edit(...)` and `Write(...)` for `.ril/state.json`, its backups and the lock files, plus `.claude/**` and `.git/**` for the permission settings and git hooks) stop only those two tools from writing those files, so they prevent accidents. A worker running `node` or `git` can still write them | Host-enforced, unmeasured: an owner re-check in `tests/e2e/RUNBOOK.md`. The entries themselves: `tests/preflight.test.mjs` |
| A stuck item is set aside with a reason and the rest carries on | CLI: `ril skip`. Test: `tests/recovery.test.mjs` |
| A finished real run ends in a state that meets every acceptance condition | Test of the checker: `tests/e2e/check-state.test.mjs`. The real run itself is manual (`tests/e2e/RUNBOOK.md`) |
| Protected acceptance files: the second line of `.ril/docs/verification/verify.md` is `Protected: <path>, <path>` (paths inside the project). `ril checkpoint --seal` records each path's git id in `state.seals`. `ril ledger record proven-*` is refused when a protected path differs from the last seal, when none is sealed yet, or when a path is outside the project; a plain `ril checkpoint` and `ril status --full` print a line when they differ. A fresh tester restores the files (skill instruction) | CLI rail: `ril ledger record`, `ril checkpoint --seal`. Tests: `tests/seal.test.mjs` |
| Budget raised: `engineLines` 2551 to 2606 for the seal rail (+55 net lines, R2 task 5); verification rails are the heavy part. `.ril/status.md` (unused) was deleted. R6 lowers totals again | Test: `tests/charter.test.mjs` |
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
| The project's tool list (`.ril/tools.json`) is approved once, by hash: `ril allowlist write --approved` grants its permissions only when the last `Approved tools <sha256>` decision matches the file and no pattern is broad or outside the project; `--force` does not bypass | CLI: `ril allowlist`. Tests: `tests/preflight.test.mjs`, `tests/tools.test.mjs` |
| Risky or irreversible actions are never done silently | Skill instruction only (standing rule 7), plus the host's own permission prompts |

## Known limits

These rules are only an instruction to an agent, or nothing yet. A model that ignores them is not stopped by RIL.

- The seal: any agent that can run `ril checkpoint --seal` can reseal changed files, or edit the `Protected:` line of `verify.md` or `state.json`; only a restored file is checked, who restored it is not.
- Workers changing state: `Bash(ril *)` still lets any agent run any `ril` command, including registering a fake verifier.
- Verifier independence: anyone can register an agent with the role `verifier`.
- The allowlist grants `Edit(./**)` and `Bash(node *)` (and `Bash(git *)`, `Bash(npm install *)`), which let workers run and change the project they build. The deny entries stop only the Edit tool from writing the state files; a worker running `node` or `git` can still write them. State integrity against a determined agent is not protected: there is no signing and no state kept outside the project.
- Evidence is not hashed, so a file can be changed after it was recorded.
- Acceptances never expire.
- The `ril-control` rules, the rules read, retry, light and full review, plain language to the person, and risky actions never done silently.
- Names of other plugins in docs and in `tests/e2e`.

## Run log

Filled in by the owner after each real run (see `tests/e2e/RUNBOOK.md`).

| Date | Run | What needed a human or stalled | What we changed |
|------|-----|--------------------------------|-----------------|
| 2026-10-20 | Baseline run (todo, 15 scenarios, 82 agents, 2h14m, at least $28.5): all proven, checker accepted, but not unattended | C1: 87 worker commands denied by the 12-entry allowlist, finished only with all of Bash; C2: workers could not read the plugin folder | Tool list approved at design (R2); allowlist adds the plugin read rule (R2); one-simple-command rule for workers (R3) |
| 2026-10-20 | Baseline run | I1: batch verifiers proved 15 scenarios with 2 verifiers; reviews skipped to save budget; no rail saw it | Ledger refuses a verdict when the verifier's registered unit is not that scenario (R2); never-skip rule (R3) |
| 2026-10-20 | Baseline run | I2: the host refuses workers writing report files (166 times); controller saved replies and once changed a failed to done | The reply is the report, saved verbatim (R3) |
| 2026-10-20 | Baseline run | I3, I5, I6, I7, I8: controller ran tests and shell fixes itself; turns ended with nothing running; no catch-up after a new session; person's email filled in; review caps accepted real defects | Short rules in the router (R3), each citing this row |
| 2026-10-20 | Baseline run | I4: Finder and Explorer files tracked, then blocked proofs | `ril init` ignores them (R2) |
| 2026-10-20 | Baseline run | M3: 15 scenarios and 82 agents for four commands; drill: resume without redoing proven work passed, catching a killed worker not exercised, catch-up failed | At most 8 first-version scenarios (R3); R4 repeats the drill with a worker running at the kill |
