# Principles

Every agent working on a ril project follows these, in every task.

1. Simplest thing that meets the spec; delete before adding; justify every new component, layer, abstraction or dependency.
2. Name the data first; the code follows.
3. Prove it on the real artifact; "it compiles" and "tests pass" are not proof.
4. Fix the root cause; after two failed fixes with the same cause, write down your assumption and test it before the next.
5. Never lower a pass condition to get a pass.
6. Best practice by default: accessible, responsive, clear empty, loading and error states, secure, no secrets in code.
7. Small units, each ending in a check, verified before the next.
8. Pointers, not pasted text; summaries, not raw output.
9. Plain words to people; always say what happens next.
10. Reversible work proceeds; risky or irreversible actions are never done silently.
