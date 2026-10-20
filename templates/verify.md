Trusted: no
Protected: .ril/docs/verification/, <the verify command's script>, <the acceptance-test folder>
<!-- Proof kit, saved as .ril/docs/verification/verify.md. Keep the first two lines first. Protected paths are written by a tester only; implementers and fixers never edit them. Delete this line. -->
# Proof kit: <project name>

## Launch
- <How a clean temporary folder outside the project is made, and how the program is installed there the way a person gets it.>
- <The starting state: no config, no data, no leftovers.>

## Drive
- <How to run each scenario's commands by the program's real name; each feature map names the commands.>
- The verify command: `<for example npm run verify>`. It reruns every check and every test and prints how many checks it ran; zero, or fewer than last time while the feature map did not shrink, is a failure.

## Evidence
- One transcript per scenario and saved version: `.ril/evidence/<id>/<saved version>/transcript.txt`, each entry `$ command`, then `stdout:`, `stderr:` and `exit code:` exactly as they were.
- <Any other evidence this project needs, such as a file the program wrote, read back afterwards.>

## Cleanup
- Remove the temporary folder and everything installed into it; keep `.ril/evidence/` as it is.
- Check that the project has no new files except the evidence (`git status`).

## Doctor
Run after a stop, before trusting any earlier proof:
1. <The build or install command>: it finishes without errors.
2. The verify command: it runs and prints a checks count above zero.

## Self-run
Run once, by a verifier, on the first real build:
1. Run Launch, Drive, Evidence and Cleanup for one scenario, and the verify command.
2. Copy the project into a temporary folder and make one deliberate break there (a scratch change, never in the project) that breaks what one check covers.
3. Run that check in the copy: it must fail. A check never seen failing is not trusted.
4. Then undo the break and run it again: it passes. Then cleanup, and confirm the evidence survived it.
5. Only then set the first line to `Trusted: yes (<saved version>)`, and say so in the report so the controller logs a decision.
