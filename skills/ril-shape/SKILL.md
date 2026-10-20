---
name: ril-shape
description: Turns the person's idea into a short spec of provable scenarios, a chosen target and stack, and a passing preflight. Use when the ril front door finds no `.ril/` folder, or the project is in the shape stage.
---

# ril-shape

## Outcome

The person's idea is cut to its core loop and written as a short spec, `.ril/docs/spec.md`, in which every scenario can be proven by running the real program. Its scenarios are loaded into ril, the target and stack are chosen and written down, the tools the project needs are installed, and the person agrees that this is what they meant.

## Rules

**Command-line programs only.** ril builds command-line programs only for now: programs a person runs by typing a command in a terminal (recipe `cli`). If the idea needs a web page, a phone app or a desktop window, say so plainly in one or two sentences and offer a command-line version of the same idea. If they decline, stop there: say ril cannot build it yet and change nothing. Never pretend to support more. Check this before anything else when the idea plainly needs a screen, and again whenever the interview shows it. If you find out only after `ril init` has run, tell the person the same way and change nothing: the next /ril resumes in shape.

**Start.** If a `.ril/` folder exists, the project was started before: the mode is on the first line of `ril status --full`; read `.ril/docs/intake.md` and carry on from the first step below that is not done. Otherwise:
1. The folder. If the current folder is the home folder, or not where the person wants the project, ask where it should live, create that folder, tell them to open a new session in it and type /ril, then stop.
2. Ask the mode, one question, in plain words, with the default:
   - "Autonomous (my default): I ask you a few questions now, then I decide everything else myself and show you a one-page summary before I build."
   - "Guided: I also stop and ask you at each important decision: what to build it with, what it should do, how it is put together, and the order I build it in."
3. Only then run `ril init --mode <autonomous|guided> --name <project>`, with a short name from the idea (or the folder name).
4. Right after it, run `ril allowlist write --base --tool claude` and tell the person: "Claude Code will ask you once to trust this folder; say yes, so my helpers can work without stopping to ask you." Workers in the background cannot answer permission prompts, so this happens before any worker starts.
The mode is chosen only here; it cannot be switched later. Wherever this skill says guided or autonomous, the mode is on the first line of `ril status --full`.

**The interview (the intake).**
- First play the idea back in your own words, in two or three sentences, and ask what is wrong with it.
- Then ask one question at a time, in plain words. Cover: who it is for, the must-have behaviours, what is out, the commands they will type and what they expect to see, and accounts or keys they already have.
- Give every question a default and label it "my assumption", so a "yes" is enough.
- Before asking anything, check whether the answer can be observed (read files in the folder, run `node --version`, look at what is installed). If it can, observe it instead of asking.
- Cut to the core loop: the fewest scenarios that make the idea useful, done well. Everything you cut goes under `## Later` in the spec. Tell the person plainly what you cut and that they can ask for any of it back.
- Suggest the simplest stack that needs nothing extra on this machine: for a command-line program, plain Node.js with its built-in test runner, and no runtime dependency unless it saves real work. Guided: ask it here, once. Autonomous: decide and say what you chose.
- Autonomous mode: ask every permission now, once: may I install missing tools (say which are system-wide), may I use paid keys. Never ask again later; anything not approved here is done another safe way or parked.
- In both modes, ask once, in these plain words: may I install the libraries the project needs (this lets the workers run `npm install` and `npm ci`, which can download and run other people's code)? If the person says no, the project is designed with no dependencies (the simplest stack, plain Node.js; say so plainly) and every worker's brief says "do not add libraries" (the proof kit still installs the project's own packed copy into a throwaway folder).
- Write `.ril/docs/intake.md` yourself as you go: the idea in their words, your playback and their corrections, each answer, each "my assumption", the target, stack and recipe (`cli`) as plain text, the permissions given, and what was cut. ril state does not hold any of these; this file does.
- Autonomous mode: log each choice you made for the person with `ril decision log --stage shape --decision "<what>" --why "<why>"`.

**The spec.** Spawn an `author` through `ril-control` (unit `shape`) to write `.ril/docs/spec.md` from `<plugin folder>/templates/spec.md` (the folder from `ril root`), with the intake in `inputs`. Copy this acceptance into its brief:
- Every scenario is a `### S<n>: <title>` block with a `Criterion:` line saying what a person does and sees, checkable by running the real program, and a `Proof:` line. The methods are ui, api, cli and golden; ril can prove only `Proof: cli` for now, so every scenario uses it.
- Anything that cannot be proven by running the program (a matter of taste, a service it cannot reach, a real device) goes under `## Needs a person` as a plain bullet, never as a scenario.
- What was cut is listed under `## Later`. Plain words; no placeholder left.
Then run `ril scenario import .ril/docs/spec.md --check`. If it lists problems, a fresh `author` fixes them, with the previous report in `inputs`.
For each item under `## Needs a person`, park a question: `ril gate park needs-<n> --question "<plain words>" --options "I will check it myself|drop it" --default "I will check it myself"`. Ask it now, record the answer with `ril gate resolve`, and keep the answer in the intake.

**Review.** Run `ril-review` on the spec (light review). Guided mode: then ask the person to sign off the spec.

**Load the scenarios.** Run `ril scenario import .ril/docs/spec.md`. If the spec changes after that, keep ril in step: `ril scenario update <id>` for a changed scenario, `ril scenario add` (or import again) for a new one.

**Tools.** Run `ril preflight ${CLAUDE_PLUGIN_ROOT}/recipes/cli`. For each missing tool (`ril preflight --json ${CLAUDE_PLUGIN_ROOT}/recipes/cli` gives the install command):
- Ask once: "Shall I install it for you, or guide you step by step?" Autonomous mode: use the permission from the intake; do not ask again. Guided mode: always ask.
- Install it for you: say first what it changes on the machine when it is system-wide, run the install, and log it with `ril progress "Installed <tool>."`.
- Guide: walk them through the tool's guide one step at a time, waiting for each step.
- A tool only the person can install: guide them.
- Run the preflight again until it says everything is installed.
Then run `ril allowlist write --recipe ${CLAUDE_PLUGIN_ROOT}/recipes/cli --tool claude`, which adds the project's own checks to the permissions written at the start.

**Guided-mode sign-offs.** Target and stack (after the interview), then the spec (after its review). The stack was already asked in the interview: the sign-off shows the choice in plain words and does not ask again about it. Each is a question: `ril gate park signoff-<what> --question "<plain words, with where to read it>" --options "yes|change it" --default yes`, ask it, then `ril gate resolve signoff-<what> --answer "<their words>"`. On "change it", a fresh `author` makes the change (the intake and the spec as `inputs`), it is reviewed again at the light level, and you ask again. For the target and stack, update `.ril/docs/intake.md` first, then have the spec changed the same way. The controller never edits the spec itself.

**When ril refuses** a command, read its message and its `Next:` line, do what it says, and run it again. Never use `--force` here without the person's yes.

**How you talk.** Plain words, short sentences, one question at a time; never show ids, commands, file contents or error text unless asked; every message ends with what happens next.

## Done when

- `ril scenario import .ril/docs/spec.md` exited 0, and `ril scenario list` shows every scenario in the spec.
- `ril preflight ${CLAUDE_PLUGIN_ROOT}/recipes/cli` says everything is installed, the base allowlist was written right after `ril init`, and the recipe allowlist after the preflight.
- The last `ril-review` of the spec left no must-fix, or each one left is recorded as an accepted risk.
- Guided mode: the target and stack, and the spec, are signed off.
- `ril progress "Spec ready: <n> scenarios."`, then `ril stage set design`, and `ril-design` has started.

## Involve the person when

- The intake: the mode, the playback, and each interview question.
- The idea needs more than a command-line program.
- Guided-mode sign-offs: the target and stack, and the spec.
- A tool is missing: install it for you, or guide step by step (in autonomous mode this permission is asked once, in the intake).
- An item under `## Needs a person`.
- Anything risky, irreversible or paid, and a review cap reached.

## Ask the CLI

- `ril init --mode <mode> --name <project>`: create the project, once the mode is known.
- `ril status --full`, `ril root`: the mode (its first line) and the plugin folder.
- `ril scenario import` (with `--check` first), `ril scenario add`, `ril scenario update`, `ril scenario list`: the scenarios.
- `ril gate park`, `ril gate resolve`: sign-offs and items that need a person.
- `ril decision log`: choices made for the person.
- `ril preflight`: what the machine lacks.
- `ril allowlist write`: the project's permissions.
- `ril progress`, `ril stage set`: record the step and move to design.
