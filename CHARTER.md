# RIL charter

The owner's words. Every plan and every review cites this file. A plan or review that narrows one of these sentences lists that as an owner decision; it never decides it alone.

## What RIL is
- "software factory ... deliver staff software engineer quality software"
- "plugin should [be] very very easy to work with and any users should be able to work with it not just developer"
- "RIL should handle all kinds of projects including webapp, API or backend, mobile app, native desktop app for specific os, CLI tools, library etc."

## Process
- idea -> design -> spec -> plan -> tasks -> tests -> implementation -> verification with proof -> fixes -> run -> complete.
- Adversarial review at every stage. Track everything so work recovers when agents stop. Protect context with subagents. Two modes: autonomous and guided.

## Verification is the heavy part
- "verification process should be determined based on what kind of project user is making and it should be very strong to catch all the issues so that agent can read to fix those problem and this loop will make the product functional eventually."
- "adversarial review [and] playwright, desktop use also part of verification where it make sense"
- The model chooses and writes each project's proof method; the shipped files hold the evidence standard and the rails.

## How RIL itself is built
- "todays llm and agents are very smart so we dont need to dogfood them everything. what we need to make sure is they are going in right direction, proper process and verification in place."
- "general direction, principles, autonomy limits, subagent rules and checkable "done" definitions, and playbooks can be short checklists with evidence requirements. heavy parts should be the verification and the restrictions, not step-by-step instructions to the model"
- "implementation of RIL plugin should also be simple, extendable, best architecture, no place for slop, unnecessary or unuseful process"

## Past failures we must not repeat
- "project become complex as we progressed ... unmanageable"
- "plugin was not that simple to use and users were confused, unclear, helpless"
- "agents were breaking here and there due to very strict process and there was no recovery and users were getting annoyed"

## Targets (checked by tests/charter.test.mjs against tests/charter-budget.json)
- One visible skill (playbook and reference files allowed). Direction words (skills, roles, templates, principles.md) at most 5,500.
- No language, framework, package-manager or project-type instruction in skills, roles, templates or playbooks; driver kinds in the proof-kit surface table are allowed; worked examples live in `examples/` and say so.
- Engine at most 2,500 lines and 18 command groups; tests at most 4,000 lines; zero runtime dependencies.
- A new rule cites a Run log row or a failing test. Each rule lives in one place.
- Every milestone ends with a diet pass and a review by someone who reads only this file and the tree.
- Today's ceilings in tests/charter-budget.json are higher than these targets; later units lower them.
