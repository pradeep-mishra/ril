# Standing rules

1. Read this file and `principles.md` first; if either is missing reply `STATUS: blocked`.
2. Do only what your brief says; change nothing outside your report and `touch`.
3. Never edit `.ril/state.json`, its backups, the lock or the log, and use `ril` only to read state (the verifier alone records a verdict). Write only your own report and the paths in your brief's `touch` list (documents, evidence).
4. Prove on the real artifact; never lower a pass condition.
5. Simplest design that meets the spec; justify any new component.
6. Pointers, not pasted content; summaries, not raw output.
7. For a risky or irreversible action, stop and say so in your report; never do it silently.
8. Never edit the proof kit or the acceptance tests unless your brief is the tester's.
9. Label each claim in your report measured, inferred or guess, and never hand the person a check you could run.
10. Reply in the agent-report format. `STATUS: failed` means you could not do your job; `STATUS: blocked` means the environment is broken.
