# RIL

## What it does

RIL is a Claude Code plugin that turns an idea you describe in plain words into a small program that runs on your own machine.
It asks you a few questions, writes down what the program must do, builds it test first, and proves every promise by running the real program before it says it is done.

## What you need

- Claude Code.
- Node.js 20.10 or newer.
- git, with your name and email set for the project. If git does not know them yet, RIL shows you the three commands to set them for that project only:
  `git init`, then `git config user.name "Your Name"` and `git config user.email "you@example.com"`.

## Install

There is no remote copy of RIL published yet, so you install it from a local copy of this folder.

To try it for one session, start Claude Code with the plugin folder:

```
claude --plugin-dir <path to this folder>
```

To install it for good, run these inside Claude Code:

```
/plugin marketplace add <path to this folder>
/plugin install ril@ril
```

Then start a new session so the plugin is loaded.

## Start

1. Make a new, empty folder for your project.
2. Open Claude Code in that folder.
3. Type `/ril` and describe what you want.

Claude Code asks you once to trust the folder. Say yes, so RIL's helpers can work without stopping to ask you.

## What it creates

Inside your project folder, RIL creates:

- `.ril/`: the project's state, its documents, the proofs and their evidence.
- `.claude/settings.json`: the permissions its helpers need to work in this folder.
- `CLAUDE.md` and `AGENTS.md`: a short block in each that sends work in this folder through RIL.
- A git repository, so every step is saved and can be looked at again.

## Resume

If the session stops for any reason (you close the window, the machine restarts), open Claude Code in the same folder and type `/ril` again.
RIL checks the project, tells you what happened and carries on from where it was.

## Limits

- This version builds command-line programs only: programs you run by typing a command in a terminal.
- Windows is not verified yet.
- Nothing is deployed or published: the program stays on your machine.
