# Build

## Checks
- **Which plan.** The first `plan-<n>` in `ril unit list --kind plan` not `verified` or `parked`. Start: `ril checkpoint`, then `ril unit set plan-<n> --state doing --checkpoint <id>`. Plans after the first start with prove's drift check. On resume, skip what exists; never rebuild a task `built` or later.
- **Tasks.** An author writes `.ril/docs/plans/plan-<n>-tasks.md`: vertical slices, each with `Scenarios:`, `Files:` (at most 5), `Tests:`, `Run:` and `Expected:`, every scenario served. Light review, then `ril unit add plan-<n>-t<k> --kind task --parent plan-<n> --title "<title>"`.
- **Pilot.** Plan 1's T1 is the thinnest end-to-end slice and builds the verify command. It goes through prove's self-run and verification before any other task. First, before any other file, it writes `.gitignore` from design.md's stack: what that stack generates (dependencies, build output, caches, local settings, OS files), nothing the project needs. If it shows the tasks, kit or task size wrong, fix that first and `ril decision log` why.
- **Each task:**
  1. A tester writes the acceptance tests and shows the red run, unit tests only, before any code exists.
  2. `ril checkpoint --seal`, only after a tester.
  3. An implementer makes them pass.
  4. `ril checkpoint`; if it says protected files changed, a fresh tester restores them and seals.
  5. A task marked `Risk: high` in the tasks file (rails, security, money, data loss, concurrency, design.md's costly-bug places) gets a full review of its files now; others skip it.
  6. `ril unit set plan-<n>-t<k> --state built`.
- **Review**, build's adversarial review: ONE full review of the plan's whole diff since its start, when its last task is built (`ril checkpoint` first), before prove's verifiers. It checks `git ls-files` for generated output; any found: fix `.gitignore`, `git rm -r --cached <path>`, `ril checkpoint`.
- **Fix round**, for review findings and failed verdicts. A code must-fix, or a failed verdict that needs code changes, resumes the implementer that wrote it: send the findings, `ril agent set <implementer id> --state running`, save each new reply as its own file (`report-2.md`, never overwriting), then done or failed again. The fix starts with a failing test; then `ril checkpoint` and a fresh reviewer or verifier, never the implementer. A protected-file finding goes to a fresh tester. If it cannot be resumed (stopped, lost in a crash with no newer reply file, host refuses): a fresh `fixer` with the brief and the previous replies. Document findings go to a fresh author.
- **Scope.** A task needing a file outside its `touch`, another scenario or a design change stops. Autonomous: a fresh author changes the tasks or plan, decision logged. Guided: ask first.

## Evidence required for done
- `ril unit list --kind task` shows every task `built`, or parked and replanned around.
- Each tester's reply shows its red run, failing for the stated reason.
- A seal followed every tester; the last `ril checkpoint` reported no protected change.
- The last review says `must-fix: 0`, or each left is "Accepted risk for <id>" in `ril decision list`.
- `git ls-files` lists no generated output.
- Prove started at the current saved version.
