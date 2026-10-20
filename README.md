# RIL

RIL is a Claude Code plugin that turns an idea, described in plain words, into working software that has been proven by running it.
You answer a few questions. RIL writes down what the software must do, builds it test first, and checks each promise on the real thing before it says it is done.
It is made for anyone, not only developers, and aims to work for any kind of software.

## Install and start

You need Claude Code, Node.js 20.10 or newer, and git.
There is no published copy yet, so use a local copy of this folder.

- Try it for one session: `claude --plugin-dir <path to this folder>`
- Install it as a Claude Code plugin, inside Claude Code:
  `/plugin marketplace add <path to this folder>` then `/plugin install ril@ril`, then start a new session.

Then make an empty folder, open Claude Code in it, type `/ril` and describe what you want.
Say yes when Claude Code asks you to trust the folder, so RIL's helpers can work without stopping to ask.
If git does not know your name and email, RIL shows you the exact commands to set them for this project only.

## What happens

The path is: idea, design, spec, plan, tasks, tests, build, proof, fixes, run, done.

- **Two modes.** You pick one at the start. Autonomous: RIL decides and tells you what it decided. Guided: RIL also asks you to sign off each stage's key document.
- **What you are asked.** Plain questions, one at a time, with RIL's pick as the default. RIL stops and asks first before it spends money, deletes data, uses secrets, publishes or sends anything off this computer, or does anything else risky.
- **What "proven" means.** Each promise in the spec is a scenario. A scenario is proven only when a separate checker, not the builder, ran the real software the way a person would, kept the evidence, had the work reviewed, and tried to break it. If any proof fails, the failure goes back to a fixer, round after round, up to a limit.
- **Done** means every scenario is proven on the current saved version, or set aside with your explicit okay. The final report says what is not covered.

Your folder gets `.ril/` (state, documents, evidence), a permissions file for the helpers, a short block in `CLAUDE.md` and `AGENTS.md`, and a git repository.

## If it stops

Close the window, lose the machine, crash: open Claude Code in the same folder and type `/ril`.
RIL checks the project, repairs what is safe, tells you what happened, and continues. Proven work is not redone.

## What is in the repo

```
skills/ril/       the one skill: router (SKILL.md), playbooks/, references/, worker-rules.md
agents/           ril-agent, the one worker agent
templates/        briefs, reports, spec, verification and final-report forms
bin/  lib/        the ril command line: state, rails and recovery (no dependencies)
tests/            node tests; tests/e2e has the manual run guide
examples/         a worked proof kit, labelled as an example
docs/             decisions.md, cut-list.md, spikes.md
CHARTER.md  principles.md
```

## Tests

`npm test` (same as `node --test`). It needs only Node.
A real run with a model cannot be automated: follow `tests/e2e/RUNBOOK.md`.

## Charter, decisions, limits

- `CHARTER.md` holds the owner's words and the size targets every change is checked against.
- `docs/decisions.md` lists every rule, what enforces it, the run log, and the known limits: rules that are only instructions to an agent, not checked by code.

Known limits in short: real runs so far covered one command-line tool only, so other kinds of software are a goal, not a measured result. Windows is not verified. Nothing is deployed or published. See `docs/decisions.md` for the full list.
