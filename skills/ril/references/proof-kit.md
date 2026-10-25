# Proof-kit guide

For kit authors and verifiers. The kit is `.ril/docs/verification/verify.md` plus `.ril/docs/verification/feature-map/<id>.md` per scenario. You choose the method; this is the standard.

## Surface, driver, evidence

The label says how a scenario is observed, not what the product is. Drive every surface a person or caller really uses.

| Label | Surface | Driver kind | Evidence |
|---|---|---|---|
| `ui` | browser page | a real browser driven like a person | screenshots, page snapshot, console and network log |
| `ui` | desktop window | the OS accessibility or desktop driver | window screenshots, accessibility tree |
| `ui` | mobile screen | a device simulator or real device | screenshots, device log |
| `api` | service endpoint | an HTTP or protocol client | requests and responses verbatim, stored data read back |
| `api` | library | a small consumer program, public interface only | the program and its output |
| `cli` | terminal | a terminal harness | command, output, errors, exit code, files written |
| `golden` | data or model output | a dataset evaluation on a fixed sample, threshold from the spec | per-item results, score |

## Kit rules

1. **Clean starting state**, defined by the kit (data stores, devices, accounts, settings, caches) and recreated every run. Never the person's data, real settings or home folder: use a throwaway one.
2. **Launch it as a person gets it**: built, installed or served as released, outside the project.
3. **Doctor**: after a stop, it starts, the verify command counts above zero, each driver answers.
4. **Drive every way a person can reach the feature**: no hidden route, internal call or state a person could not create.
5. **Evidence is what was observed**: verbatim, never tidied or retyped, non-empty, under `.ril/evidence/<id>/<saved version>/`. Zero checks or a gap is never a pass.
6. **Cleanup keeps the evidence** and removes everything else, leaving nothing in the person's folders.
7. **One verify command** reruns every automated check and prints the count. A drop while the feature map did not shrink is a failure.
8. **Name every stand-in** and list what it left unproven under `## Not covered`.
9. **No approved driver:** get one approved first; only then ask the person to observe, and label that evidence theirs.
10. **Pin what makes proofs lie**: leftovers, clocks, randomness, network.
11. **Real-app runs**: use the least intrusive driver (a separate display or session, a simulator, a hidden window); if only an intrusive one exists, say so in "What I can prove on this machine". Red once, in the self-run, then per the logged choice: batched = ONE launch running all checks, after each task's implementer and once per plan for proofs; at the end = only in accept; as they come = per check.
12. **Taste is not a pass**: split "feels right" into checkable parts; screenshots go to the person.

## Break-it pass

After the happy path: bad or boundary input, empty state, the same action twice, interruption, a slow or missing dependency, denied permission, and concurrent use where it applies. Each run is evidence.

## Attack questions

The review guide's questions, plus: is an expected value produced by the code under test? Would a deliberate break turn it red?
