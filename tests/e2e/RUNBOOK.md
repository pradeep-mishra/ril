# Running RIL for real (milestone 1 acceptance)

Steps 1 and 2 need a real model session, so they are done by hand. Nothing in `npm test` can do them.
Step 3 is automated. This runbook is how milestone 1 is accepted.

## 1. Run RIL on the todo list idea (manual)

1. Make an empty folder and go into it. Do not run `git init`; `ril checkpoint` creates the repository. Git must already know your name and email.
2. Start Claude Code with the plugin: `claude --plugin-dir <path to this repo>`.
3. Type `/ril`.
4. Paste the text in `tests/e2e/todo-cli.idea.md`.
5. Answer the intake questions as an ordinary person would. Do not give technical hints.
6. When RIL shows the project brief, read it and answer `go`.
7. Leave it alone. Write down every time you had to step in, and every time it stopped.

## 2. The kill-and-resume drill (manual)

1. While the build is running (stage `build`), run `ril ledger summary` in the project folder and keep the output. If bare `ril` is not on your PATH yet, run `<repo>/bin/ril ledger summary` instead (`<repo>\bin\ril.cmd ledger summary` on Windows).
2. Stop the session: close the terminal window. Do not wait for it to finish.
3. Open a new terminal in the same folder and start `claude --plugin-dir <path to this repo>` again.
4. Type `/ril`. It should say what happened and carry on from where it was.
5. Run the same `ledger summary` command again and compare. A scenario that was `proven` before must still be `proven`, and its saved result must be unchanged, so it was not redone.
6. Let the run finish.

## 3. Check the result (automated)

Run `node tests/e2e/check-state.mjs <folder>` from this repo. It exits 0 only when:
the stage is `done`; each scenario is proven (or set aside with an "Accepted as unproven" decision);
each proof has a passing result on the current saved version, with real evidence, a verifier agent,
a clean review (or accepted risks) and at least one check; the final report has a "What is not covered" section;
the proof kit is trusted; nothing is unsaved; no agent is still working.
It prints a short summary, including the decisions made and what recovery did.
Exit codes: 0 accepted, 1 not accepted, 2 it cannot read the folder as a ril project.
On `NOT ACCEPTED`, each `PROBLEM:` line names one thing to fix. Fix it with `/ril` or by hand, run the checker again, and log each problem in step 4.

## 4. Record what happened

For every place the run needed a human, stalled, or needed an extra rule, add a row to the "Run log" in `docs/decisions.md`.
Name the failure you saw, not a guess about its cause, and say what was changed. Add a new rule only for a failure that repeated.
If a step above could not be done, say that in the log too.

## What cannot be tested here (owner re-checks)

Mark each one in the run log once you have seen it work.

- Typing `/ril` in an interactive session. The spike only measured it with `claude -p`.
- Whether allowlist entries written into the project settings in the middle of a session take effect without a restart.
- Whether the allowlist entry `Edit(.ril/**)` still matches when Claude Code is started from a subfolder.
- The Windows launcher `bin/ril.cmd`.
- A first real install of the plugin, and whether a bare `ril` works from the shell afterwards.
