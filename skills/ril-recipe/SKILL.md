---
name: ril-recipe
description: Writes the proof kit before any code: one feature map per scenario and the project's verify.md, saying how each scenario is launched, driven, proven and cleaned up. Use when ril-design reaches the proof kit, when `ril scenario coverage` names a scenario, or when a scenario changed.
---

# ril-recipe

## Outcome

Before any code exists, every scenario has a feature map, `<project>/.ril/docs/verification/feature-map/<id>.md`, saying exactly how it will be proven on the real program, and the project has one proof kit, `<project>/.ril/docs/verification/verify.md`, saying how to launch, drive, collect evidence, clean up, check health after a stop, and prove the kit itself before anyone trusts it.

## Rules

**One recipe in this version.** ril ships one recipe, `cli`: `${CLAUDE_PLUGIN_ROOT}/recipes/cli/recipe.md`. Every kit starts from it and keeps its headings. Recipes for other kinds of project are a later milestone; never invent a recipe.

**A scenario this version cannot prove.** If a scenario's method is not `cli` (ui, api or golden), say plainly to the person that this version can only prove command-line behavior. Every scenario a person would experience through a screen needs a real UI proof, never only unit tests, and this version has none. Park it, as `ril-design` does for an unprovable criterion: `ril gate park unprovable-<id> --question "<what cannot be proven yet, in plain words>" --options "rewrite it|accept it unproven|drop it" --default "rewrite it"`, ask it, record the answer with `ril gate resolve`, and act on it the way `ril-design` says (rewrite it: `ril scenario update` and this skill again for that scenario; accept or drop: `ril skip <id> --scenario --reason "<their words>"`, then the set-aside feature map). Flag the same way any `cli` criterion you cannot prove by running the program. Never weaken a criterion to make it provable.

**Who writes the kit.** A fresh `author` spawned through `ril-control` (unit `design`) writes it, never you. Its brief:
- `inputs`: `<project>/.ril/docs/spec.md`, `<project>/.ril/docs/design.md`, `<plugin folder>/recipes/cli/recipe.md`, `<plugin folder>/templates/feature-map.md` and `<plugin folder>/templates/verify.md` (the folder from `ril root`), and the report format.
- `touch`: `<project>/.ril/docs/verification/verify.md` and one `<project>/.ril/docs/verification/feature-map/<id>.md` per scenario it writes. When this skill runs again for one scenario, only that map (and `verify.md` if the kit changes).
- `acceptance`, copied in:
  - Each feature map follows `templates/feature-map.md`: first line `Method: <the scenario's method>`, then `Covers:` (the files the proof relies on, or `none yet`) and `Synced at:` (a saved version, or `none yet`), then `## Sub-features`, `## How to get to it`, `## Driving it`, `## Gotchas`, every part filled. Every sub-feature has a pass condition a transcript can show: exact output, file or exit code.
  - Each promise the design lists under `## Where a bug would cost the most` gets a property-based or generated-input test named in its feature map; any tool for it is installed inside the project only.
  - `verify.md` follows `templates/verify.md`: first line `Trusted: no`; a `Protected:` line naming the proof kit (`.ril/docs/verification/` and the verify command's script) and the acceptance-test paths, which implementers and fixers must never edit and only a tester writes; `## Launch`, `## Drive`, `## Evidence`, `## Cleanup` from the recipe; `## Doctor` (after a stop: the project builds, and `verify` runs and prints a checks count above zero); `## Self-run`.
  - The `verify` command named in the kit reruns every check and every test and prints how many checks it ran. It is built in plan 1 by a tester, at a `Protected:` path.
  - The `## Self-run`: the first verifier runs the kit once against the first real build, makes one deliberate break (a scratch change in a throwaway copy of the project), confirms the check catches it, undoes it, confirms the evidence survived cleanup; only then does the kit become `Trusted: yes (<saved version>)`. A check never seen failing is not trusted.
  - Every claim in the report is labelled measured, inferred or guess.

**Then:** review the kit with `ril-review` at the light level, against the spec. Run `ril preflight ${CLAUDE_PLUGIN_ROOT}/recipes/cli`; if the kit needs a tool that is missing, ask install-or-guide the way `ril-shape` does. Run `ril allowlist write --recipe ${CLAUDE_PLUGIN_ROOT}/recipes/cli --tool claude` again so the workers can run the kit without a prompt. Then `ril scenario coverage`; for each scenario it names, this skill again for that scenario only. A set-aside scenario gets the set-aside feature map from `ril-design` (first line `Method: <its method>`, then why it was set aside), never a full one.

**Drift check, at the start of each plan after plan 1.** `ril-build` asks for it. A fresh `verifier` through `ril-control` reruns the verify command and the Driving steps of every scenario proven so far, at the current saved version; its `touch` is its evidence folder `<project>/.ril/evidence/drift-<n>/` and the feature maps, of which it may change only the `Synced at:` line. It records no verdict. It judges each failure as drift in the kit (the map no longer matches the program) or a real bug, and names the files behind it. Drift in a map: this skill again for that scenario (the fresh author also updates `Covers:`). Drift in a `Protected:` test or the verify script: a fresh `tester`. A real bug: the fix loop in `ril-verify`. Never weaken a check to make it pass.

**When ril refuses** a command, read its message and its `Next:` line, do what it says, and run it again.

**How you talk.** Plain words; never show ids, commands or file contents unless asked; every message ends with what happens next.

## Done when

- `ril scenario coverage` exits 0.
- `verify.md` starts `Trusted: no`, has a `Protected:` line, and has every part above; the kit's light review left no must-fix, or each one is an accepted risk.
- Every scenario that is not `cli`, and every criterion found unprovable, was rewritten, accepted unproven or dropped, as the person chose.

## Involve the person when

- A scenario cannot be proven by this version, or a criterion cannot be proven at all: rewrite it, accept it unproven, or drop it.
- The kit needs a tool that is not installed.
- Anything risky, irreversible or paid.

## Ask the CLI

- `ril root`: the plugin folder, for the recipe and template paths.
- `ril scenario coverage`: every scenario has its feature map. `ril scenario list`: each scenario's method.
- `ril scenario update`, `ril skip`: a rewritten or set-aside scenario.
- `ril gate park`, `ril gate resolve`: a scenario this version cannot prove.
- `ril preflight`: the tools the kit needs.
- `ril allowlist write`: the permissions to run the kit.
