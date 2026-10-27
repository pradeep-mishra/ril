# Build

## Checks
- **Which plan.** The first `plan-<n>` in `ril unit list --kind plan` not `verified` or `parked`. Start: `ril checkpoint`, then `ril unit set plan-<n> --state doing --checkpoint <id>`. Plans after the first start with prove's drift check. On resume, skip what exists; never rebuild a task `built` or later.
- **Tasks.** When the plan starts, an author writes `.ril/docs/plans/plan-<n>-tasks.md`: at most 10 vertical slices (more: split the plan, log it; guided asks), each with `Scenarios:`, `Files:` (at most 5, its `touch`), `Tests:` (what to prove, the public signatures called, no bodies), `Run:` (its tests, plus earlier suites sharing its files; never the whole suite), and `Expected:`; every scenario served. Light review, then `ril unit add plan-<n>-t<k> --kind task --parent plan-<n> --title "<title>"`.
- **Pilot.** Plan 1's T1 is the thinnest end-to-end slice and builds the verify command. It goes through prove's self-run and verification before any other task. First it writes `.gitignore` for what the stack generates (dependencies, build output, caches, local settings, OS files), nothing the project needs. Its first acceptance: build and test commands run green from a worker; a block is a person step (design.md `humanSteps`), not a retry. If it shows the tasks, kit or task size wrong, fix that first and `ril decision log` why.
- **Each task:**
  1. A tester writes the acceptance tests and shows the red run in the project (compiled, failing for the stated reason), unit tests only, before any code.
  2. `ril checkpoint --seal`, only after a tester whose reply is `done` with that red run.
  3. An implementer makes them pass and runs `Run:`; real-app checks in it follow `skills/ril/references/proof-kit.md` rule 11.
  4. `ril checkpoint`. Protected files changed, or the implementer reports a sealed test wrong: a fresh tester restores or corrects it and seals; a corrected test goes back to the same implementer.
  5. A task marked `Risk: high` in the tasks file (rails, security, money, data loss, concurrency, design.md's costly-bug places) gets a full review of its files now; others skip it.
  6. `ril unit set plan-<n>-t<k> --state built`.
- **Plan close**, last task built: a fresh implementer (`touch: none`) runs the verify command; failures go to the fix round, then it runs again. The whole suite runs only here.
- **Review**, build's adversarial review: ONE full review of the plan's whole diff since its start, after a green plan close (`ril checkpoint` first), before the verifiers. It checks `git ls-files` for generated output; any found: fix `.gitignore`, `git rm -r --cached <path>`, `ril checkpoint`.
- **Fix round**, for review findings and failed verdicts. A code must-fix, or a failed verdict that needs code changes, resumes the implementer that wrote it: send the findings, `ril agent set <implementer id> --state running`, save each new reply as `report-2.md`, never overwriting. The fix starts with a failing test; then `ril checkpoint` and a fresh reviewer or verifier, never the implementer. A protected-file finding goes to a fresh tester. If it cannot be resumed (stopped, lost in a crash with no newer reply file, host refuses): a fresh `fixer` with the brief and the previous replies. Document findings go to a fresh author.
- **Scope.** A file outside `touch` that design.md's layout names: add it, log it, resume the implementer as in a fix round. Another file, scenario or a design change stops. Autonomous: a fresh author changes the tasks or plan, decision logged. Guided: ask first.

## Evidence required for done
- `ril unit list --kind task` shows every task `built`, or parked and replanned around.
- Each tester's reply shows its red run, failing for the stated reason.
- The plan close ran green before the review.
- A seal followed every tester; the last `ril checkpoint` reported no protected change.
- The last review says `must-fix: 0`, or each left is "Accepted risk for <id>" in `ril decision list`.
- `git ls-files` lists no generated output.
- Prove started at the current saved version.
