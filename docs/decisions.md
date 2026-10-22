# Rules and what enforces them

This file keeps every rule RIL has and what actually enforces it. "CLI rail" means the `ril` command refuses.
"Test" means a test in this repo fails if the rule breaks. "Skill instruction only" means an agent is told to
follow it and nothing checks. "Nothing yet" means the rule is not enforced at all.
A rule that nothing enforces is a candidate for a check. A new rule is added only after the same failure shows up in
a real run, and the failure is named in the Run log below.

## The rules

| Rule | Enforced by |
|------|-------------|
| Rail 1: a scenario becomes `proven` only through a result recorded by a registered `verifier` agent at the current saved version, with a non-empty evidence file under `.ril/evidence/` (anywhere else is refused), at least 1 check and a clean review (or risks after "Accepted risk for <id>") | CLI rail: `ril ledger record`. Tests: `tests/ledger.test.mjs`, `tests/lifecycle.test.mjs` |
| An untrusted kit, or no proof kit at all (`.ril/docs/verification/verify.md` missing), accepts only a `blocked` result. The kit is trusted only when line 1 of `verify.md` is `Trusted: yes (<saved version>)` and `state.selfruns` holds a row for that version whose `kit` hash (verify.md from line 2 on, plus every other file in `.ril/docs/verification/`) still matches, recorded by `ril ledger selfrun` (a registered verifier, the current saved version, two different non-empty evidence files under `.ril/evidence/`: the kit failing on a deliberate break, then passing restored). A verifier may record only for the scenario it was registered for | CLI rail: `ril ledger record`, `ril ledger selfrun`. Tests: `tests/kit.test.mjs`, `tests/ledger.test.mjs` |
| Rail 2: the project reaches `done` only when every scenario is proven at the current saved version, or set aside with "Accepted as unproven: <id>", and at least one scenario is proven; zero scenarios is refused. When nothing can be proven, the accept playbook parks the project (`ril stage set parked`) | CLI rail: `ril stage set done`. Test: `tests/lifecycle.test.mjs` |
| Rail 3: a scenario's criterion and method are frozen once past `confirm`, unless `--force "<reason>"` (which is logged) | CLI rail: `ril scenario update`. Test: `tests/scenario.test.mjs` |
| Rail 4: `ril round bump` past the cap (default 8) exits 4 and stores nothing | CLI rail: `ril round bump`. Tests: `tests/scenario.test.mjs`, `tests/lifecycle.test.mjs` |
| `round reset` needs `--force "<reason>"` and logs the reason as a decision | CLI rail: `ril round reset`. Test: `tests/scenario.test.mjs` |
| `--force` never bypasses Rail 2 (`done`) or Rail 4 (the cap) | CLI rail: `ril stage set`, `ril round bump`. Tests: `tests/lifecycle.test.mjs`, `tests/scenario.test.mjs` |
| A bad agent brief is refused (exit 6) | CLI rail: `ril agent register`. Test: `tests/agent.test.mjs` |
| Every refusal prints a `Next:` line saying what to do | CLI: all commands. Tests: the `fails` helper in `tests/helpers/repo.mjs`, used by most test files |
| State is saved atomically, with a backup and a lock | Test: `tests/store.test.mjs` |
| Recovery: damaged state, stale lock, dead agents, orphaned units. Doctor demotes a proof only for missing or empty evidence or a lost saved version; a later change no longer demotes (accept mode re-verifies every scenario) | CLI: `ril doctor --fix`. Tests: `tests/recovery.test.mjs`, `tests/lifecycle.test.mjs` |
| The allowlist denies only `Edit(.claude/**)`, so workers cannot change the permission settings with the Edit tool. State files, lock files and `.git` are not denied: Claude Code's sandbox turns a deny on a path into a write block, which stops `ril` and `git` themselves. `Write(...)` rules are never consulted by Claude Code, so none are written. Re-running `ril allowlist write` removes the older deny entries | Host-enforced, unmeasured: an owner re-check in `tests/e2e/RUNBOOK.md`. The entries themselves: `tests/allowlist.test.mjs` |
| A stuck item is set aside with a reason and the rest carries on | CLI: `ril skip`. Test: `tests/stage.test.mjs` |
| A finished real run ends in a state that meets every acceptance condition | Test of the checker: `tests/e2e/check-state.test.mjs`. The real run itself is manual (`tests/e2e/RUNBOOK.md`) |
| Protected acceptance files: the second line of `.ril/docs/verification/verify.md` is `Protected: <path>, <path>` (paths inside the project). `ril checkpoint --seal` records each path's git id in `state.seals`. `ril ledger record proven-*` is refused (`--force` does not bypass) when a protected path differs from the last seal, when none is sealed yet, or when a path is outside the project; a plain `ril checkpoint` and `ril status --full` print a line when they differ. A fresh tester restores the files (build playbook) | CLI rail: `ril ledger record`, `ril checkpoint --seal`. Tests: `tests/kit.test.mjs` |
| Budget lowered in R6: engine 2649 to 2485 lines, tests 4528 to 3984, 38 files in `lib/` to 18, every file at most 300 lines (tests too). `ril ledger carry` is gone, single-importer modules are merged, test files are merged and share helpers. The R2 raises (seal +55, kit self-run +48) are paid; no rail was weakened | Test: `tests/charter.test.mjs` |
| Budget lowered in R3: one router, five playbooks, two references, one worker agent: skills 8 to 1, agents 6 to 1, direction words 14,532 to 5,500, banned hits 85 to 0; `tests/skills.test.mjs` is structural only (no prose pins). Removed rules are in `docs/cut-list.md` | Test: `tests/charter.test.mjs` |
| Workers never change state; only the verifier records a result | Skill instruction only (worker rules). The allowlist entry `Bash(ril *)` lets any agent run any `ril` command |
| The verifier is independent of the builders | Rail 1 needs a registered agent whose role is `verifier`, but anyone can register one. Skill instruction only |
| Router rules: only fresh workers with a full brief; never spawn an unregistered agent; the controller never runs the product, its tests or the proof, and never changes tracked files; refuse roles the CLI does not know | Skill instruction only (router `skills/ril/SKILL.md`). The CLI refuses an unknown role at `ril agent register` |
| Every worker reads `skills/ril/worker-rules.md` and `principles.md` first | Instruction only. The CLI checks only that the brief lists two rules paths |
| Retry by failure kind (cap or memory: smaller scope; network: as is; unknown: once; then park) | Skill instruction only (router) |
| Light review for plans, full review for built code | Skill instruction only (`skills/ril/references/review.md`) |
| The reviewer goes first and `--review` comes from its report | The CLI refuses `none` for a proven result (`ril ledger record`; `tests/ledger.test.mjs`). The rest is skill instruction only (`skills/ril/playbooks/prove.md`) |
| Evidence is not changed after it is recorded | Nothing yet: evidence is checked to exist and be non-empty, but is not hashed |
| An acceptance ("Accepted risk", "Accepted as unproven") stays valid for as long as the project lives | Nothing yet: acceptances never expire, even if the scenario changes |
| Plain language to the person: one question at a time, no internals | Skill instruction only (`principles.md`, the router and playbooks) |
| Size and wording limits (skills, direction words, roles, engine and test lines, command groups, banned terms, no runtime dependencies) | Test: `tests/charter.test.mjs` against `tests/charter-budget.json` |
| Every `ril` command the router, playbooks, worker rules, wrapper and templates name exists; every file they name exists; each file stays within its word budget | Test: `tests/skills.test.mjs` |
| No shipped file names another plugin | Test: `tests/skills.test.mjs` for direction files. For docs and `tests/e2e` it is an author and reviewer restriction, not a test |
| The project's tool list (`.ril/tools.json`) is approved once, by hash: `ril allowlist write --approved` grants its permissions only when the last `Approved tools <sha256>` decision matches the file and no pattern is broad or outside the project; `--force` does not bypass | CLI: `ril allowlist`. Tests: `tests/allowlist.test.mjs`, `tests/tools.test.mjs` |
| A permission pattern that would let any command run, pass commands to a shell or an administrator, run a downloaded script, reach a path outside the project, or let a worker edit `.ril`, `.claude` or `.git` is refused, whoever approved it; `--force` does not bypass | CLI rail: `ril allowlist write --approved` (`checkAllow`). Tests: `tests/tools.test.mjs`, `tests/allowlist.test.mjs` |
| A shipped recipe is never trusted. There is no recipe file the CLI reads; the worked example lives in `examples/` and says so, and a kit earns trust only through the self-run row above | Deleted with `lib/recipe.mjs`. Test: `tests/kit.test.mjs` (trust needs the recorded self-run) |
| `ril allowlist write` (both forms) also allows `Read(//<plugin folder>/**)` so workers can read templates and rules (the host spells an absolute path with a second leading slash, and a drive as `/c/`); `ril init` and `ril checkpoint` put `.ril/`, `.DS_Store` and `Thumbs.db` in the repository's own exclude file, so documents, evidence and state never change the saved version and a pass never needs carrying (README, then the final verification; any other change needs a new proof) | CLI: `ril allowlist`, `ril init`, `ril checkpoint`. Tests: `tests/allowlist.test.mjs`, `tests/init.test.mjs`, `tests/checkpoint.test.mjs`. Evidence: Run log 2026-10-20, C2, I4 and the carry row |
| Settings written into `.claude/settings.json` in the middle of a session take effect without a restart | Host-enforced, unmeasured: the gate before R2 merges, `tests/e2e/RUNBOOK.md`. If it fails, approval moves before the build session starts |
| Risky or irreversible actions are never done silently | Skill instruction only (worker rule 8 and the router's stop list), plus the host's own permission prompts |

## Known limits

These rules are only an instruction to an agent, or nothing yet. A model that ignores them is not stopped by RIL.

- The seal: any agent that can run `ril checkpoint --seal` can reseal changed files, or edit the `Protected:` line of `verify.md` or `state.json`; only a restored file is checked, who restored it is not. Git-ignored protected paths and symlink targets outside the project are invisible to it.
- Workers changing state: `Bash(ril *)` still lets any agent run any `ril` command, including registering a fake verifier.
- Verifier independence: anyone can register an agent with the role `verifier`.
- The allowlist grants `Edit(./**)` and `Bash(node *)` (and `Bash(git *)`, `Bash(npm install *)`), which let workers run and change the project they build. State and lock files are not protected from the Edit tool (a deny on them breaks `ril` and `git` under Claude Code's sandbox); a worker running `node` or `git` can write them too. State integrity against a determined agent is not protected: there is no signing and no state kept outside the project. The recovery is the CLI's `state.json.bak` and `ril doctor --fix`.
- The self-run: the CLI checks that two different non-empty evidence files exist, not that the first shows a failure and the second a pass; any agent can register a verifier and run `ril ledger selfrun`. The kit reviewer attacks the kit before the self-run; the CLI cannot read what evidence means.
- A hand-written `selfruns` row in `state.json` fakes a self-run (state is not protected).
- A project from before R2 whose kit says `Trusted: yes (<version>)` with no self-run row refuses new proven records until `ril ledger selfrun` is run.
- `.ril/` stays out of git only through the repository's own exclude file (`ril init`, `ril checkpoint`): a clone does not share it, the next `ril checkpoint` untracks a `.ril` that was already tracked, and the seal cannot see protected paths inside `.ril/`.
- Evidence is not hashed, so a file can be changed after it was recorded.
- Acceptances never expire.
- The router rules, the rules read, retry, light and full review, plain language to the person, and risky actions never done silently.
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
| 2026-10-20 | R3 | The baseline findings above, as direction text: C1, I1 to I3, I5 to I8, M1 to M4 each live in one place | `skills/ril/` router, playbooks and worker rules replace eight skills, six role files and nine templates (R3); cut list in `docs/cut-list.md` |
| 2026-10-20 | Baseline run | I4 and its consequence (baseline report): `.DS_Store` was tracked, forced a new saved version, and `ril ledger carry` then refused it as not trivial, which led to batch verifiers | `.ril/` is git-ignored by `ril init` and `ril checkpoint`; `ril ledger carry` and its trivial-path list are removed (R6), so every product change needs a new proof |
| 2026-10-20 | Baseline run (the 70 controller and worker logs) | `ril unit list --state` and `ril scenario list --status` were never called, no playbook or worker rule names them, and no rail, recovery path or rail test used them | Removed in R6 (the commands stay; `--kind` and `ril gate list --status` were used and stay) |
| 2026-10-21 | Owner run (visual app) | the owner had to ask the agent by hand for browser mockups to settle the UI | `prototype` playbook, skippable at intake |
| 2026-10-22 | Owner run (desktop app) | autonomous testers launched the real app every few seconds and made the computer unusable; kit left a file in the real preferences folder | one question asked once at design, logged and copied into every brief; unit-test red only; batched real-app runs; real settings never used |
