Trusted: no
Protected: <comma-separated project paths only a tester changes: acceptance tests, the verify command's files>
<!-- Keep lines 1 and 2 first; line 1 changes only after a self-run. Delete this line. -->
# Proof kit: <project>

## Surfaces and drivers
- <label>: <driver kind, the approved tool, what it observes>

## Starting state
- <Data stores, devices, accounts, settings, made fresh each run.>

## Launch
- <Built and started as a person gets it, outside the project.>

## Drive
- Verify command: <one command; reruns every check and prints the count>.
- <How each driver runs feature map steps.>

## Evidence
- <What each surface saves under .ril/evidence/<id>/<saved version>/.>

## Cleanup
- <What is stopped and removed; evidence stays.>

## Doctor
- <Builds and starts; the verify command counts above zero; each driver answers.>

## Self-run
- <The check to break, the break, the command that fails then passes.>

## Not covered
- <What each stand-in left unproven, or "Nothing.">
