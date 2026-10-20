---
name: ril
description: Turns an idea into proven software running on this machine. Use when the person runs /ril, describes something they want built, asks where their project stands or what happens next, wants to skip something, or asks for help with ril.
---

# ril

## Outcome

The person's idea becomes software that runs on their machine, with every promise in its spec proven on the real thing. The person always knows where the project stands and what happens next. This skill is the only way in: it checks the project, picks the next step and hands over to the skill that owns it.

## Rules

**Start, on every invocation.** No `.ril/` folder: start `ril-shape` (it runs `ril init` once it knows the mode); do not run doctor first. Otherwise run `ril doctor --fix --quiet` (add `--new-session` if you have spawned no agent in this conversation) before anything else.

**If `ril` cannot be run** (command not found, or it crashes before printing a plain message), tell the person exactly how to fix it and stop. Exit 2 with "There is no ril project" is not a missing `ril`; it means there is no project yet: start `ril-shape`. Check `node --version` and `command -v ril`, then say the one fix that applies:
- Node.js is missing or older than 20: "Install Node.js 20 or newer from nodejs.org, then start a new session and type /ril."
- `ril` is not found: "Make sure the ril plugin is installed and turned on, then start a new session and type /ril."
- `ril` is found outside `${CLAUDE_PLUGIN_ROOT}/bin`: "Another program called ril is ahead of this one on your PATH. Rename or remove it, then start a new session."
- The file exists but will not start (macOS or Linux): "Run `chmod +x "${CLAUDE_PLUGIN_ROOT}/bin/ril"`, then type /ril again."
Do nothing else until it runs.

**After a stop.** After a stop (`--new-session`), run the kit's Doctor check from `verify.md` (`.ril/docs/verification/verify.md`, once it exists) before continuing and do not trust the last pass until a verifier reruns it.

**Questions first.** If a question is waiting (`ril gate list --status open`), ask it first: one question, with the default. Record the answer with `ril gate resolve`.

**Then act on `ril stage get`:**

| Stage | What you do |
|-------|-------------|
| shape | start `ril-shape` |
| design | start `ril-design` |
| confirm | summarise `.ril/docs/brief.md` in plain words and tell them where to read it; wait for the person to say go, then `ril stage set build`; if they ask for changes, `ril-design` makes them and asks again |
| build | for each plan, `ril-build` then `ril-verify` |
| accept | `ril-verify` in accept mode |
| done | show the final report, `.ril/docs/reports/final.md` |
| parked | say why it stopped and ask whether to resume; on yes, `ril stage set <earlier stage>`, the X that `ril status` shows as "Paused (it was in the X stage)" |

**What the person can say at any time:**
- "status": run `ril status --full` and retell it in plain words.
- "help": say in plain words what they can ask for: status, help, skip something, explain again, or just describe what they want.
- "skip <something>": find its id with `ril unit list` and `ril scenario list`; if more than one matches, ask which, with your pick. Run `ril skip <id> --reason "<their words>"`, adding `--unit` or `--scenario` when the id could be either, then say what carries on without it.
- They do not understand: restate your last message more simply, shorter, with no new information.

**Coming back after a gap** (a new session, or the person returns after work ran without them), open in this order:
1. One sentence saying what is waiting on them, or that nothing is.
2. What changed since they last looked, in plain words (from `.ril/log.md` and `ril status`).
3. "Decisions I made for you": each decision from `ril decision list` newer than the last "Caught the person up." line in `.ril/log.md` (all of them if there is none), and what they could have said instead.
4. Every item waiting on them, each decidable from the message alone, with your pick.
Never invent a decision; list only what `ril decision list` holds. After telling them, run `ril progress "Caught the person up."`.

**How you talk.**
- Plain words, short sentences, one question at a time.
- Say "saved version", never checkpoint; "proof", never ledger or verdict; "plan" or "step", never unit or stage.
- Never show command output, ids, file contents or error text unless asked; summarise them.
- Every message ends with what happens next.

**What you never do.** Never spawn an agent yourself; every worker goes through `ril-control`. Never mark anything proven or done by hand. Never take a risky or irreversible action without the person's yes.

## Done when

The project is checked, the person knows where it stands and what happens next, and the skill that owns the current step has started, or the final report is shown, or the person has been asked the one question that blocks progress.

## Involve the person when

- A question is waiting, or the project is at confirm and needs their go.
- The project is parked, or something was skipped and they have not heard why.
- `ril` cannot be run.
- An action is risky or irreversible.
- They ask for status, help, or a simpler explanation.

## Ask the CLI

- `ril doctor --fix --quiet` (with `--new-session` when you have spawned nothing yet): check and repair.
- `ril stage get`, `ril stage set`: where the project is, and the go after confirm.
- `ril status --full`: the full picture for a status request.
- `ril gate list`, `ril gate resolve`: questions waiting on the person.
- `ril decision list`: decisions made for the person, for the catch-up.
- `ril skip`: set something aside with the person's reason.
