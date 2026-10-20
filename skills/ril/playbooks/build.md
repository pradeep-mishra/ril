# Build

Goal: each plan built test first, one task at a time, plans in order; its code survives a full review; a saved version goes to prove.

## Checks
- **Which plan.** The first `plan-<n>` in `ril unit list --kind plan` not `verified` or `parked`. Start: `ril checkpoint`, then `ril unit set plan-<n> --state doing --checkpoint <id>`. Plans after the first start with prove's drift check. On resume, skip what exists; never rebuild a task `built` or later.
- **Tasks.** An author writes `.ril/docs/plans/plan-<n>-tasks.md`: vertical slices, each with `Scenarios:`, `Files:` (at most 5), `Tests:`, `Run:` and `Expected:`, every scenario served. Light review, then `ril unit add plan-<n>-t<k> --kind task --parent plan-<n> --title "<title>"`.
- **Pilot.** Plan 1's T1 is the thinnest end-to-end slice and builds the verify command. It goes through prove's self-run and verification before any other task. If it shows the tasks, kit or task size wrong, fix that first and `ril decision log` why.
- **Each task:**
  1. A tester writes the acceptance tests and shows the red run.
  2. `ril checkpoint --seal`, only after a tester.
  3. An implementer makes them pass.
  4. `ril checkpoint`; if it says protected files changed, a fresh tester restores them and seals.
  5. `ril unit set plan-<n>-t<k> --state built`.
- A test the implementer calls wrong goes to a fresh tester.
- **Review.** All tasks built: `ril checkpoint`, then a full review of the files changed since the plan's start. Must-fix goes to a fresh fixer, a protected-file finding to a fresh tester; after each round, `ril checkpoint` and a fresh reviewer, up to the cap.
- **Scope.** A task needing a file outside its `touch`, another scenario or a design change stops. Autonomous: a fresh author changes the tasks or plan, decision logged. Guided: ask first.
- **Hand over.** `ril checkpoint`; prove verifies the plan at that version.

## Evidence required for done
- `ril unit list --kind task` shows every task `built`, or parked and replanned around.
- Each tester's reply shows its red run, failing for the stated reason.
- A seal followed every tester; the last `ril checkpoint` reported no protected change.
- The last review says `must-fix: 0`, or each left is "Accepted risk for <id>" in `ril decision list`.
- Prove started at the current saved version.
