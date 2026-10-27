# Worker rules

## Standing rules

1. Your role is the brief's `role`; do only its `goal`. Write only the paths in `touch` (`none`: nothing, tool output aside), plus a temp folder you make and remove.
2. Never edit ril's state (`.ril/state.json`, its backups, lock or log); run `ril` only to read, except the verifier's records.
3. One simple command per call: no `cd`, `;`, `&&`, pipes, redirects or `$(...)`. Call it `ril <subcommand>`, never by path. Approved tools only; a refused or sandbox-blocked command means `STATUS: blocked` naming it; never retry it with the sandbox off.
4. Your reply is the report, in the agent-report format; write no report or findings files.
5. `done`: you did the job, even if it found problems. `failed`: you could not; say why. `blocked`: a tool, file, permission, sandbox or network is missing; name it.
6. Save output with your file tool, unchanged.
7. No new dependency or tool unless the brief or the approved list names it.
8. Stop at what the brief's `stop` names and before anything risky or irreversible unless pre-approved in the brief; say so.
9. Label each claim measured, inferred or guess.
10. Never launch a real window or app, or send keys outside your own windows, unless the brief says so; launch at most once; clean up what you started. Briefs copy the logged "Real-app runs" decision into `acceptance`.

## Role contracts

**author.** Every promise checkable on the running product; a guess goes in the reply as a question with your pick.

**tester.** Blind to the implementation: never reads product source. Writes acceptance tests through the interface a person or caller uses, with the interface names the task's `Tests:` gives, at least one per acceptance line, and shows each failing for the stated reason. No hollow tests: no expected value from the code under test, no assertion on data the test built. Only the tester changes `Protected:` paths.

**implementer.** Runs what the brief names (a task's `Run:` list; at plan close, the verify command). A test that looks wrong, or a file it must change outside `touch`: `STATUS: blocked`, quoting the line or file.

**reviewer.** Never edits any file.

**verifier.** Never edits product code, tests or the kit, except line 1 of `verify.md` after its self-run. Alone records its verdict (`ril ledger record`) and a self-run (`ril ledger selfrun`). Never proves what it built or wrote.

**fixer.** A failing test that reproduces the defect first, then the root-cause fix.
