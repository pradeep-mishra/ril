# Running RIL for real (milestone 1 acceptance)

Steps 1 and 2 need a real model session, so they are done by hand. Nothing in `npm test` can do them.
Step 3 is automated. This runbook is how milestone 1 is accepted.

## 1. Run RIL on the todo list idea (manual)

1. Make an empty folder and go into it. Do not run `git init` up front; `ril checkpoint` creates the repository when there is none. Git must know your name and email, globally or set for this project by the guide RIL shows (it starts with `git init`, which is fine).
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
5. Run the same `ledger summary` command again and compare. Proofs recorded before the kill stay `proven` afterwards, and their saved results are unchanged, so they were not redone (files changed later no longer undo a proof; only missing evidence or a lost saved version does).
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

## Mid-session permission check (manual)

The plugin writes the permission rules mid-session. Check once that Claude Code applies them without a restart.

1. In an empty folder, start a session with the plugin and run `ril init`.
2. In that same session run `ril allowlist write --base --tool claude`. Do not restart. Accept the trust prompt if one appears.
3. In the same session ask for a small file edit, then ask for a `git status`.
4. Note whether any permission prompt appeared for the edit or for `git status`, and add the result to the Run log in `docs/decisions.md`.

If a prompt appears, the rules do not apply mid-session. Then approval must happen before the build session starts: the design stage writes and approves the tool list, runs `ril allowlist write --approved --tool claude`, ends the session, and asks the person to type `/ril` in a new one. Change the design playbook to say so.

## What cannot be tested here (owner re-checks)

Mark each one in the run log once you have seen it work.

- Typing `/ril` in an interactive session. The spike only measured it with `claude -p`.
- Whether allowlist entries written into the project settings in the middle of a session take effect without a restart (the gate above).
- Workers edit product files without a prompt (the `Edit(./**)` allow rule), also when Claude Code was started from a subfolder of the project.
- The deny rules really block a worker from editing `.ril/state.json`: try asking a worker to edit .ril/state.json with the Edit tool and confirm it is refused; note that a `node` command could still write it (the deny rules stop accidents, not a determined agent).
- The git identity guide works in a new folder on a machine without a global git identity: `git init` and the project-local `git config user.name` and `git config user.email` lines let `ril checkpoint` save.
- The Windows launcher `bin/ril.cmd`.
- A first real install of the plugin, and whether a bare `ril` works from the shell afterwards.
