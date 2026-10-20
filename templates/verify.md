Trusted: no
Protected: tests/acceptance/, <the verify command's script file, for example scripts/verify.mjs>, package.json scripts.verify, scripts.test, scripts.preverify, scripts.postverify, scripts.pretest, scripts.posttest
<!-- Proof kit, saved as .ril/docs/verification/verify.md. Keep the first two lines first. Protected entries are changed by a tester only; implementers and fixers never edit them. This file and the feature maps are changed only by an author or verifier whose brief lists them in touch. Delete this line. -->
# Proof kit: <project name>

## Launch
- Use only allowed commands, so nothing stops to ask: make the temporary folder with `node -e` (`fs.mkdtempSync(path.join(os.tmpdir(), 'ril-'))`, call it `<tmp>`), then `npm pack --pack-destination <tmp>` and `npm install --prefix <tmp> <tmp>/<tarball>`.
- <Anything else this project needs to be installed there the way a person gets it.>
- <The starting state: no config, no data, no leftovers.>

## Drive
- Run each scenario's commands as `node <tmp>/node_modules/.bin/<name> ...`, which counts as running the program by its real name; each feature map names the commands.
- The verify command: `<for example npm run verify>`. It reruns every check and every test, including `tests/acceptance/` and `tests/regression/`, and prints how many checks it ran; zero, or fewer than last time while the feature map did not shrink, is a failure.

## Evidence
- One transcript per scenario and saved version: `.ril/evidence/<id>/<saved version>/transcript.txt` (evidence counts only as a non-empty file under `.ril/evidence/`), each entry `$ command`, then `stdout:`, `stderr:` and `exit code:` exactly as they were.
- <Any other evidence this project needs, such as a file the program wrote, read back afterwards.>

## Cleanup
- Remove the temporary folder and everything installed into it with `node -e` (`fs.rmSync('<tmp>', { recursive: true, force: true })`); keep `.ril/evidence/` as it is.
- Check that the project has no new files except the evidence (`git status`).

## Doctor
Run after a stop, as a health check before work carries on (earlier proofs stay proven):
1. <The build or install command>: it finishes without errors.
2. The verify command: it runs and prints a checks count above zero.

## Self-run
Run once, by a verifier, on the first real build:
1. Run Launch, Drive, Evidence and Cleanup for one scenario, and the verify command.
2. Copy the project into a new temporary folder with `node -e` (`fs.mkdtempSync`, then `fs.cpSync('<project>', '<tmp>/copy', { recursive: true })`), and write one deliberate break there with `node -e` (`fs.writeFileSync`; a scratch change, never in the project) that breaks what one check covers.
3. Run that check in the copy (for example `npm run verify --prefix <tmp>/copy`): it must fail. A check never seen failing is not trusted.
4. Then undo the break (copy that one file back from the project with `fs.cpSync`) and run it again: it passes. Then cleanup (`fs.rmSync`), and confirm the evidence survived it.
5. Only then set that first line to `Trusted: yes (<saved version>)` (only the first line counts), and say so in the report so the controller logs a decision.
