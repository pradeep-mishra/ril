# Proving a command-line project

This guide is for the agent that proves a scenario whose method is `cli`. Proof means running the real
program the way a person would and keeping what actually happened. Reading the code or running only the
unit tests is not proof.

## What you need
- Node.js and git (`ril preflight recipes/cli` checks both).
- The scenario: its id, its criterion (the sentence that must be true) and the checkpoint (the saved
  version of the code you are proving).

## Launching
1. Make a clean temporary directory outside the project (for example with `mkdtemp`). Never run the
   program inside the project folder, so stray files cannot hide a bug or leak into the project.
2. Install or link the project into that directory the way a person would get it (for example
   `npm pack`, then install the tarball there). Run the command by its real name, not by calling
   internal files.
3. Start from nothing: no config, no data, no leftovers from an earlier run.

## Driving
1. Run the commands the scenario describes, one at a time, with realistic input.
2. For every command, record the exact command line, everything it printed to stdout, everything it
   printed to stderr, and its exit code.
3. Then try to break it: a missing argument, a bad value, an empty input, running it twice, pressing
   Ctrl+C part-way. Record those runs the same way.

## Collecting evidence
- Write one transcript per checkpoint to
  `.ril/evidence/<scenario>/<checkpoint>/transcript.txt`.
- Each entry shows `$ command`, then `stdout:`, `stderr:` and `exit code:` as they really were. Do not
  tidy, shorten or retype the output.
- Add the transcript path when you record the result with `ril ledger record`.

## Checking the criterion
- Read the real output and compare it with the scenario's criterion, word for word where the
  criterion names exact text or an exit code.
- If the real output differs, the scenario is not proven. Record `failed` with what you saw, not what
  you expected.
- If the program could not be run at all (the install broke, a tool is missing), record `blocked`.

## The verify command
The project has a `verify` command (for example `npm run verify`). It runs the linter, the type check
and the tests, and it prints how many checks it ran. Run it at the same checkpoint and pass that
number as `--checks` when you record.
- A run that executed zero checks is a failure, even if it exited 0.
- If the number is lower than last time and the feature map did not shrink, say so in your report.

## Cleaning up
- Remove the temporary directory and anything you installed into it.
- Keep `.ril/evidence/` as it is; that is the proof.
- Confirm the project folder has no new files except the evidence (`git status`).
