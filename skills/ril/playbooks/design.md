# Design

Goal: before any code, the person reads a one-page brief and says "go". Takes spec and intake from shape; hands design, plans and kit to build.

## Checks

- **Design**, by an author, `.ril/docs/design.md`: the data first; security and non-functional needs, with numbers; at most three places where a bug costs most, each with a stronger check; static checks and one verify command that reruns everything and prints its check count.
- **Surface and driver** per scenario: the surface a person uses and the driver kind that proves it (`skills/ril/references/proof-kit.md`). Unprovable: `ril gate park unprovable-<id>` (rewrite it, accept it unproven, drop it); a rewrite goes through a fresh author and `ril scenario update`, the others `ril skip <id> --scenario --reason "<their words>"`.
- **Tools**, `.ril/tools.json`: `requires` (each with `name`, `detect` as `<program> <version-flag>`, `guide`, `reason`, optional `install`; `human` for the person's own steps), `allow` patterns inside the project, `humanSteps` (the person's own steps, and what proof needs from the machine: a permission, a download, a free port, a tool Claude Code's sandbox blocks with the setting that lets it); then `ril preflight`.
- **Kit**: `skills/ril/playbooks/prove.md` writes it.
- **Look**: visual surfaces, `skills/ril/playbooks/prototype.md`, before the brief.
- **Plans**, by an author, `.ril/docs/plans/plan-<n>.md`: plan 1 a walking skeleton proving one scenario; later plans vertical slices; every scenario in a plan; at most 10 tasks a plan; a larger one splits by slice, tasked once the earlier plan is verified. `ril unit add plan-<n> --kind plan --title "<title>"`.
- **Brief**, by an author, `.ril/docs/brief.md` from `templates/project-brief.md`, written last.
- **Bundle review**, design's adversarial review: ONE light review of design, tool list, kit, plans and brief together, after all are written. Guided: sign-offs on design and plan list. Then `ril stage set confirm`.
- **Confirm.** Show the brief plainly. "Tools I will use" and "What I can prove on this machine" are ONE question. If proof needs a real window, the keyboard or the screen, ask once how real-app checks run (`skills/ril/references/proof-kit.md` rule 11): batched (default), only at the end, or as they come. Log `ril decision log --stage design --decision "Real-app runs: <batched|at the end|as they come>" --why "<their words>"`. Never ask again, unless they say runs disrupt them: stop the running worker, log the new choice, carry on. Autonomous: batched, announced. On yes: `ril decision log --stage design --decision "Approved tools <hash>" --why "<their words>"` (from `ril preflight`), then `ril allowlist write --approved --tool claude`. Missing tools: install if pre-approved, else ask: install or guide. Their steps happen now, then `ril preflight` again.
- **Go** is the only start signal: `ril stage set build`. Changes instead: fresh authors, state kept in step, the bundle review again, a new brief, ask again. A changed tool list, or a tool found later, needs one new approval question.

## Evidence required for done

- The bundle review: no must-fix, or each an accepted risk; `ril scenario coverage` exits 0.
- `ril unit list --kind plan` matches the plan files.
- `ril preflight` reports all installed under the approved hash; `ril allowlist write --approved` succeeded.
- The person said "go"; `ril stage get` says build.
