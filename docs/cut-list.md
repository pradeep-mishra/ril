# Cut list

Every rule the R3 rewrite removed, where it was, and why. Reasons: duplicate, wording-level, product-specific, enforced by a CLI rail, hypothetical.

| Rule | Where it was | Why dropped |
|------|--------------|-------------|
| Per-cause fixes when `ril` cannot run (runtime version, PATH clash, chmod) | ril SKILL.md | product-specific (names a runtime); replaced by "tell the person the plain fix" |
| Question-id prefix table routing answers to skills | ril SKILL.md | wording-level; "hand the answer to the playbook that asked" |
| Skip-list of decision prefixes for the catch-up (`ril doctor:`, `Sealed`, `Carried`...) | ril SKILL.md | wording-level; "only choices made for them; repairs as one line" |
| Confirm-stage summary in the front door | ril SKILL.md | moved: confirm is the last step of design.md |
| Vocabulary list (unit, stage, ledger, verdict) | ril, ril-verify, ril-build | duplicate; kept once as "saved version, proof, step" |
| Separate control skill; ten numbered spawn steps | ril-control | duplicate; folded into router "Running workers" |
| Write the report to `report.md` | ril-control, all roles | replaced by I2: the reply is the report, saved verbatim by the controller |
| Probe a running agent read-only via `ril agent list --active` | ril-control | wording-level; resume is forbidden except an implementer's own fix rounds |
| `ril unit set <unit> --state doing/todo` around spawns | ril-control | wording-level; build.md sets unit states |
| Confirm a verdict landed with `ril ledger check` | ril-control | duplicate; lives in prove.md |
| Late result reconciled before applying | ril-control | kept as one clause ("apply what still fits") |
| Command-line programs only; offer a CLI version | ril-shape | product-specific; RIL is product-open |
| Default stack: built-in runtime and test runner | ril-shape, ril-design | product-specific |
| Ask "may I install libraries" in both modes, with package-manager commands | ril-shape | product-specific; dependencies are now in the approved tool list |
| Write target, stack, recipe into intake | ril-shape | product-specific (recipe deleted in R2) |
| Install-or-guide loop against `recipes/cli` | ril-shape, ril-recipe | enforced by a CLI rail (`ril preflight` reads `.ril/tools.json`); moved to design confirm |
| `ril allowlist write --recipe` | ril-shape, ril-recipe | command removed in R2; replaced by `--approved` after the hash decision |
| Guided sign-off of target and stack | ril-shape | duplicate; guided sign-offs live once in the router |
| `ril status --full` line 1 holds the mode, repeated per skill | all stage skills | duplicate; said once in the router |
| "When ril refuses, read its Next: line" repeated per skill | all stage skills | duplicate; once in the router |
| `## Checks` part of the design names linter/type check/formatter | ril-design | product-specific; kept as "static checks" |
| Property-based test library as a dev dependency | ril-design, ril-recipe | product-specific; kept as "a stronger check" |
| Red flags: internals importable; list kept by hand twice | ril-design | wording-level; four main red flags kept |
| Set-aside scenario gets a stub feature map so coverage passes | ril-design | moved to prove.md (B) / CLI coverage; hypothetical here |
| Brief "every Needs a person item, every Later item" checklist | ril-design | duplicate; the template carries the parts |
| Accept: separate how-to-use guide | ril-verify | wording-level; README covers install, run, each feature, failure |
| Accept: secret-scan regex list and dependency audit command | ril-verify | product-specific; kept as "scan committed files for secrets" |
| Final report built from named CLI lists | ril-verify | wording-level; the template defines the content |
| Review: `findings.md` file | ril-review | replaced by I2: findings are `- finding:` items in the reply |
| Review cap: accept remaining must-fix as risk directly | ril-review | replaced by I8: one more fresh author or fixer; only disputed items become risks |
| Never let author and reviewer be the same agent | ril-review | duplicate of "a fresh reviewer, never the author" |
| Spec template example `Proof: cli` and two sample scenarios | templates/spec.md | product-specific; one sample, neutral surface |
| Brief "built with JavaScript for Node.js" example | templates/project-brief.md | product-specific |
| Placeholder prose in brief, stop and final report sections | templates | wording-level; headings carry the structure |
| Principle 7 "verified before the next"; principle 10 "reversible work proceeds" | principles.md | wording-level |
| Principles preamble line | principles.md | wording-level |
| T1's tester writes the protected script keys of the package manifest and an ignore file for installed dependencies | ril-build step 1, 3 | Product-specific |
| Manual seal check after every implementer or fixer (diff the acceptance folder and six script keys against the sealed version) | ril-build step 3, ril-verify acceptance | Enforced by a CLI rail: `ril checkpoint --seal`, `ril ledger record` and `ril ledger carry` refuse a changed protected file; `ril checkpoint` prints the change |
| "Sealed at <T> for <task>" decision after each tester | ril-build step 3 | Enforced by a CLI rail: the seal lives in state via `ril checkpoint --seal` |
| Each task has one test file; T1 also lists the verify script | ril-build step 1 | Wording-level (kept: at most 5 files, T1 builds the verify command) |
| Acceptance tests in a fixed tests folder, regression tests in another fixed folder | ril-build, ril-verify, fixer role, verify template | Product-specific (paths are the project's, named on the `Protected:` line) |
| A test must still pass when only internals change; no "never called X" check without a positive case | ril-build step 3, tester role | Wording-level (kept: through the interface a person uses, no hollow tests) |
| `ril progress "<task> built."` / "Plan <n> proven." lines | ril-build step 3, 5; ril-verify | Duplicate (progress lines are a router rule) |
| Testers, implementers and fixers run one at a time | ril-build step 3, ril-verify | Duplicate (router: one worker at a time) |
| How you talk, When ril refuses, Involve the person when, Ask the CLI | ril-build, ril-verify, ril-recipe | Duplicate (router) |
| Scope change: autonomous involves the person only when it changes the promise | ril-build | Duplicate (router: modes and stop list) |
| Set-aside scenarios listed in a plan are skipped | ril-build, ril-verify | Duplicate (prove: "all proven or set aside"; router owns set-aside) |
| Four numbered proof layers (tests, live, review, break-it) | ril-verify | Wording-level (same four kept as prove's steps) |
| Review must-fix loop counted by the review cap, never `ril round bump` | ril-verify | Duplicate (review guide owns its cap) |
| Verifier's temp folder made and filled with the runtime's one-liners, pack and install | ril-verify, ril-recipe, verify template | Product-specific (proof-kit rule 2: launch as a person gets it, outside the project) |
| `failure.md` in the evidence folder | ril-verify, ril-recipe | Replaced: the reply carries expected, observed, repro and evidence (I2) |
| After two same-cause failures, write the assumption down and test it | ril-verify, fixer role | Duplicate (principles 4) |
| Diagnosis-only fixer with a throwaway prototype | ril-verify, fixer role | Hypothetical (no Run log row) |
| Drift-regression routing (which plan's tasks and seals, return to build for the new plan) | ril-verify | Wording-level |
| At-cap options (simplify, change approach, hint, stop) and their gate commands | ril-verify | Duplicate (router: cap, stop report, modes) |
| Accept mode: README, how-to guide, secret scan, final report, carry, `done` | ril-verify | Moved to accept (writer A) |
| Dependency audit with a package-manager command | ril-verify accept step 2 | Product-specific |
| One shipped recipe; any non-`cli` scenario is parked as unprovable | ril-recipe | Product-specific (any surface is now provable; the table names driver kinds) |
| Property-based library installed as a dev dependency in the manifest | ril-recipe | Product-specific (kept: a generated-input check in the feature map) |
| `ril preflight` and `ril allowlist write --recipe` on the recipe folder | ril-recipe | Enforced by a CLI rail: the recipe is gone; tool approval lives in design (writer A) |
| Kit documents changed only by an author or verifier whose `touch` lists them | ril-recipe | Duplicate (standing rule 1) |
| Drift checker rewrites `Synced at:`; feature map `Synced at:` line | ril-recipe, feature-map template | Enforced by a CLI rail: any kit-folder change voids the self-run (kit hash); nothing reads the line |
| Doctor: earlier proofs stay proven | verify template | Enforced by a CLI rail (`ril doctor` demotes only for lost evidence or version) |
| `git status` after cleanup | verify template | Wording-level (kept: cleanup removes everything but evidence) |
| `--review none` when no reviewer report; ril then refuses a pass | verifier role | Enforced by a CLI rail (`ril ledger record`) |
| A self-run or drift brief records no verdict unless told | verifier role | Duplicate (prove: drift check records nothing) |
| Tool lists per role (reviewer and verifier without Edit) | agents/*.md | Replaced by a stated restriction in worker-rules (the wrapper inherits approved tools) |
| Prove on the real artifact; simplest design; pointers, not pasted content; plain words | standing-rules 4-6, author role | Duplicate (principles) |
| Write the report to `report.md` and reply with the same text | every role, ril-control step 4, 6 | Replaced: the reply is the report (I2) |
| Whole-suite output saved as evidence by the implementer | implementer role | Wording-level (kept: runs the whole suite; rule 6 saves output) |
| `ril ledger carry` and its trivial-path list (`.ril/`, top-level Markdown, test and doc folders, test files) | CLI (`lib/proof.mjs`, `ledger`), accept playbook | Replaced (R6, baseline I4 and the carry trouble): `.ril/` is git-ignored, so documents, evidence and state never change the saved version; any other change needs a new proof, and accept writes the README before the final verification |
| `ril unit list --state`, `ril scenario list --status` | CLI (`unit`, `scenario`) | Never called in the baseline logs, not named by any direction text (R6) |
| Commit `.ril` documents with the product; `.ril/.gitignore` that tracked only `.ril/docs` | `ril init`, `ril checkpoint` | Replaced (R6): the repository's own exclude file lists `.ril/` |
