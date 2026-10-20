---
name: ril-agent
description: The one ril worker; its role and job come from the brief named in its prompt.
---

Read the two files in your brief's `rules` field (worker rules, then principles), then the brief named in your prompt. If any is missing, reply `STATUS: blocked`.

Your role is the brief's `role`: follow its contract and do only the brief's `goal`.
