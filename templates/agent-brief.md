<!-- Agent brief, at most 60 lines: "field:" lines, list fields take "- " items, paths not pasted text; `ril: ril`, never a path. Delete this line. -->
role: <author|tester|implementer|reviewer|verifier|fixer>
unit: <the plan, task, scenario or stage>
goal: <one line: the outcome>
inputs:
- <absolute path of a file to read>
- <plugin folder>/templates/agent-report.md
acceptance:
- <a checkable condition, copied, never loosened>
touch:
- <absolute path this agent may change, or "none">
rules:
- <plugin folder>/skills/ril/worker-rules.md
- <plugin folder>/principles.md
ril: ril
report: agent-report
stop:
- <when to stop and reply, including the stop list>
