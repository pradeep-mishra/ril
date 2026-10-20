---
name: ril-design
description: Turns an approved spec into a simple design, the proof kit, plans each small enough for one agent, and the one-page brief the person confirms. Use when the project is in the design stage, or the person asked for changes at confirm.
---

# ril-design

## Outcome

A design in which every part earns its place, a proof kit that says how every scenario will be proven before any code exists, plans that each fit in one agent's context, and a one-page brief, `.ril/docs/brief.md`, that the person reads before they say go.

## Rules

**Who writes what.** Every document here is written by a fresh `author` spawned through `ril-control`, never by you. Its brief has the spec, the intake and the documents before it in `inputs`, its own document path in `touch`, and the acceptance below copied in. Each document is reviewed with `ril-review` (light review) before the next one starts; the plans are reviewed together, as one artifact. Autonomous mode: log each choice made for the person with `ril decision log --stage design --decision "<what>" --why "<why>"`.

**1. The design**, `.ril/docs/design.md` (unit `design`). Acceptance:
- The data first: what the program keeps, where, and in what shape.
- Every component, layer, file and dependency is justified in one line: what it does and why nothing simpler would do (the simplicity budget). Nothing is added for later.
- A short `## Security and non-functional` part: untrusted input, secrets, the files it reads and writes, and the speed and size needs from the spec, with a number where there is one.
- `## Where a bug would cost the most`: at most three promises where a bug would cost the most (lost data, wrong money, a security hole, corrupted state), each with its stronger check named now: a property-based or generated-input test that runs many inputs. If there is none, it says so.
- `## Red flags`: the design is screened against each of these, and any found is fixed in the design, not only listed: a shallow module (big interface, little hidden); one decision leaked into several modules; two modules writing the same state; two ways to do one task; internals other code can import; a list kept by hand in two places.
- `## Checks`: the static checks for the stack (linter, type check, formatter), installed inside the project only, and one `verify` command kept in the project (for example `npm run verify`) that reruns every check and every test and prints how many it ran, so the proof can be rerun later by anyone.
Guided mode: after its review, the person signs off the design.

**2. The proof kit**, before any code. Run `ril-recipe` to create the proof kit and the feature map for every scenario. Then `ril scenario coverage` must exit 0; if it names a scenario, run `ril-recipe` for that scenario again.

**3. The plans**, `.ril/docs/plans/plan-<n>.md`, all written by one `author` (unit `design`). Acceptance:
- Plan 1 is a walking skeleton: the thinnest program that runs end to end, sets up the checks and the `verify` command, and proves exactly one scenario.
- Each later plan is a vertical slice: something a person can run on its own once the plans before it are built, never a technical layer such as "the storage" or "the tests".
- Each plan lists the scenarios it proves; every scenario is in at least one plan.
- Each plan is small enough for one agent to hold the plan, the files it changes and their tests at once; a plan that is not is split.
After the review, add each plan in order: `ril unit add plan-<n> --kind plan --title "<its title>"`. Guided mode: then the person signs off the plan list.

**Guided-mode sign-offs** of the design and the plan list: `ril gate park signoff-<what> --question "<plain words, with where to read it>" --options "yes|change it" --default yes`, ask it, then `ril gate resolve signoff-<what> --answer "<their words>"`. On "change it", a fresh `author` makes the change, it is reviewed again, and you ask again.

**A criterion found unprovable** after the spec was approved (by the design, `ril-recipe` or a review): never quietly weaken it. Park it: `ril gate park unprovable-<id> --question "<what cannot be proven and why, in plain words>" --options "rewrite it|accept it unproven|drop it" --default "rewrite it"`, ask the person, record the answer with `ril gate resolve`, and act on it:
- rewrite it: a fresh `author` rewrites it in the spec; then `ril scenario update <id> --criterion "<new words>"` and `ril-recipe` again for its feature map.
- accept it unproven: `ril skip <id> --scenario --reason "<their words>"`, which records the decision `Accepted as unproven: <id>`; the final report lists it.
- drop it: the same `ril skip`, with "dropped" in the reason, and a fresh `author` moves it to `## Later` in the spec.
Carry on with the rest while you wait.

**4. The brief.** A fresh `author` (unit `design`) writes `.ril/docs/brief.md` from `<plugin folder>/templates/project-brief.md` (the folder from `ril root`), with the intake, spec, design and every plan in `inputs`. Acceptance: at most 30 lines, plain words, no ids or commands, every scenario in plain words, every "my assumption" from the intake, every `## Later` and `## Needs a person` item, and a working relative link to each document. Then `ril progress "Brief ready."`, `ril stage set confirm`, and do the front door's confirm step: summarise the brief in plain words, say where to read it, and wait for go.

**Changes at confirm.** When the person asks for changes instead of go: a fresh `author` changes the affected documents (the spec, design or plans), you keep ril in step (`ril scenario update`, `ril scenario import` for a new scenario, `ril unit add` for a new plan), `ril-recipe` and `ril scenario coverage` again when a scenario changed, a light `ril-review` of what changed, a new brief, and ask again. The stage stays `confirm`.

**When ril refuses** a command, read its message and its `Next:` line, do what it says, and run it again. Never use `--force` here without the person's yes.

**How you talk.** Plain words, short sentences, one question at a time; never show ids, commands, file contents or error text unless asked; every message ends with what happens next.

## Done when

- The design and the plans were reviewed by `ril-review`, with no must-fix left or each one left recorded as an accepted risk.
- `ril scenario coverage` exits 0.
- `ril unit list --kind plan` shows one `plan-<n>` for every plan file, in order, and plan 1 is the walking skeleton.
- Every unprovable criterion was rewritten, accepted unproven or dropped, as the person chose.
- Guided mode: the design and the plan list are signed off.
- `.ril/docs/brief.md` exists, `ril stage set confirm` succeeded, and the person has been shown the brief and asked for go.

## Involve the person when

- Guided mode: sign-off of the design, and of the plan list.
- A criterion is found unprovable: rewrite it, accept it unproven, or drop it.
- The brief is ready: go, or what to change.
- A review cap is reached with must-fix items left.
- Anything risky, irreversible or paid.

## Ask the CLI

- `ril root`: the plugin folder, for template paths.
- `ril unit add`, `ril unit list`: the plans.
- `ril scenario coverage`: every scenario has its feature map.
- `ril scenario update`, `ril scenario import`, `ril skip`: a changed, new or unprovable scenario.
- `ril gate park`, `ril gate resolve`: sign-offs and unprovable criteria.
- `ril decision log`: choices made for the person.
- `ril progress`, `ril stage set`: record the step and move to confirm.
