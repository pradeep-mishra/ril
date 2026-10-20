# Design

Goal: before any code, the person reads a one-page brief and says "go". Takes spec and intake from shape; hands design, plans and kit to build.

## Checks

- **Design**, by an author, `.ril/docs/design.md`: the data first; the simplest architecture; best practice in UX, design and implementation; each component and dependency justified in one line, nothing speculative; security and non-functional needs, with numbers; at most three places where a bug costs most, each with a stronger check; red flags (shallow modules, leaked decisions, two writers of one state, two ways to do one task) fixed; static checks and one verify command that reruns everything and prints its check count.
- **Surface and driver** per scenario: the surface a person uses and the driver kind that proves it (`skills/ril/references/proof-kit.md`). Unprovable: `ril gate park unprovable-<id>` (rewrite it, accept it unproven, drop it); a rewrite goes through a fresh author and `ril scenario update`, the others `ril skip <id> --scenario --reason "<their words>"`.
- **Tools**, `.ril/tools.json`: `requires` (each with `name`, `detect` as `<program> <version-flag>`, `guide`, `reason`, optional `install`; `human` for what only the person can do), `allow` patterns inside the project, `humanSteps`; then `ril preflight`.
- **Kit**: `skills/ril/playbooks/prove.md` writes it; `ril scenario coverage` exits 0.
- **Plans**, by an author, `.ril/docs/plans/plan-<n>.md`: plan 1 a walking skeleton proving one scenario; each later plan a vertical slice a person can run; every scenario in a plan; each fits one worker. `ril unit add plan-<n> --kind plan --title "<title>"`.
- Light review of each document before the next (plans together). Guided: sign-offs on design and plan list.
- **Brief**, by an author, `.ril/docs/brief.md` from `templates/project-brief.md`, reviewed against the spec. `ril stage set confirm`.
- **Confirm.** Show the brief plainly. "Tools I will use" and "What I can prove on this machine" are ONE question. On yes: `ril decision log --stage design --decision "Approved tools <hash>" --why "<their words>"` (from `ril preflight`), then `ril allowlist write --approved --tool claude`. Missing tools: install if pre-approved, else ask: install or guide. Steps only the person can do happen now, then `ril preflight` again.
- **Go** is the only start signal: `ril stage set build`. Changes instead: fresh authors, state kept in step (`ril scenario update`, `ril unit add`), review, a new brief, ask again. A changed tool list, or a tool found later, needs one new approval question.

## Evidence required for done

- Each document reviewed: no must-fix, or each an accepted risk; `ril scenario coverage` exits 0.
- `ril unit list --kind plan` matches the plan files.
- `ril preflight` reports all installed under the approved hash; `ril allowlist write --approved` succeeded.
- The person said "go"; `ril stage get` says build.
