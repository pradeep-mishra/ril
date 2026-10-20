---
name: ril-control
description: The only way ril starts a worker agent and records what it did. Use whenever a ril skill needs an author, tester, implementer, reviewer, verifier or fixer, and whenever finished workers are waiting to be collected.
---

# ril-control

## Outcome

Every piece of work is done by a fresh worker holding a complete brief, and everything a worker reports is recorded in project state by you, so the project survives a closed session or a dead agent.

## Rules

You are the only agent that changes project state. Never spawn an agent any other way. To spawn: write the brief from `templates/agent-brief.md` into `.ril/agents/<id>/brief.md` with absolute paths and the `ril:` prefix from the adapter notes; `ril agent register`; spawn in the background; never paste file contents into a brief. When a worker finishes, read its `report.md`, apply what it reports with `ril` (unit, scenario, decision, progress), then set the agent `done` or `failed`. Fix rounds and retries always get a fresh agent with the full brief and the previous report; never resume one. Never review a diff yourself; spawn a reviewer. Refuse any role outside author, tester, implementer, reviewer, verifier, fixer. Collect finished agents in batches. Retry by how it failed: a cap hit or out-of-memory gets a smaller scope, a network drop retries as-is, an unknown failure retries once; after two retries park the unit and replan around it; `blocked` (the environment is broken) goes to `ril doctor` or the person, never to a fixer; probe a running agent's outputs read-only and never resume it just to check; reconcile a late result against current state before accepting it. Tasks run in parallel only when their `touch` sets are disjoint, otherwise one at a time, in separate worktrees where the host supports them; merge one at a time and run the tests after each merge.

How to apply them:

1. **Id.** Name each agent `<role>-<unit>-<n>`, with a new `n` for every spawn, so a retry never reuses an id.
2. **Brief.** Copy the fields of `${CLAUDE_PLUGIN_ROOT}/templates/agent-brief.md`, drop its comment line and fill every field; at most 60 lines.
   - `rules`: run `ril root` for the plugin folder, then list `<folder>/templates/standing-rules.md` and `<folder>/principles.md`, in that order.
   - `ril`: on this host it is `ril` (the plugin puts it on the PATH).
   - `inputs` and `touch`: absolute paths. `touch` holds only what this worker may change, plus its own `report.md`.
   - `acceptance`: copied from the plan, task or scenario, never loosened.
   - A retry or fix round adds the previous report's path to `inputs`.
3. **Register.** `ril agent register <id> --role <role> --task "<one line>" --unit <unit> --brief .ril/agents/<id>/brief.md`. If it refuses, fix the brief and register again; never spawn an unregistered agent. Then `ril unit set <unit> --state doing` when the unit is a plan or task.
4. **Spawn.** Start the plugin agent `ril:<role>` in the background. Its whole prompt: "Your brief is `<absolute path of brief.md>`. Write your report to `<absolute path of the same folder>/report.md`." Nothing else.
5. **Collect.** Read `report.md`. If it is missing but the agent replied with a report, save that reply as `report.md` first. Apply it as the owning skill says, with `ril unit set`, `ril scenario update`, `ril decision log` and `ril progress`. Then always end the agent with a one-line result; an agent left without one keeps its unit held:
   - STATUS done: `ril agent set <id> --state done --result "<its RESULT line>"`.
   - STATUS failed or blocked, or no report at all: `ril agent set <id> --state failed --result "<what happened, in one line>"`.
6. **Verdicts.** Never record a verdict. Only the verifier does, with `ril ledger record`; confirm it landed with `ril ledger check <scenario> <checkpoint>`.
7. **Blocked.** Run `ril doctor --fix`; if it repaired something, retry once. If not, or the retry is blocked too, ask the person with `ril gate park`, naming what is missing.
8. **Park.** After two retries of a unit, `ril skip <unit> --reason "<what failed, twice>"`, then carry on with work that does not depend on it.
9. **Probe.** To see how a running agent is doing, read `ril agent list --active` and the files in its `touch`; nothing else.
10. **Late result.** Before applying a report, check with `ril status --full` that its unit still expects it. Apply only what still matches current state; note the rest with `ril progress`.

## Done when

`ril agent list --active` is empty, every agent you started is `done` or `failed` with a result, and every report has been applied or parked.

## Involve the person when

- A worker is still `blocked` after `ril doctor --fix` and one retry.
- A worker stopped before a risky or irreversible action and needs a yes.
- A unit was parked after two retries: say what failed in plain words and what happens next.

## Ask the CLI

- `ril root`: the plugin folder, for the `rules` paths.
- `ril agent register`, `ril agent set`, `ril agent list`: the workers.
- `ril unit set`, `ril unit list`, `ril scenario update`, `ril scenario list`: apply a report.
- `ril decision log`, `ril progress`: record why and what happened.
- `ril ledger check`: confirm a verifier's verdict landed.
- `ril skip`, `ril gate park`, `ril doctor`, `ril status`: when something is stuck.
