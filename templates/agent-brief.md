<!-- Agent brief: at most 60 lines. One "field:" line each; list fields take "- " items. Paths, never pasted content. Delete this line. -->
role: <author|tester|implementer|reviewer|verifier|fixer>
unit: <the plan, task, scenario or stage this work is for>
goal: <one line: the outcome, not the steps>
inputs:
- <absolute path of a file to read>
acceptance:
- <a checkable condition that means the work is done>
touch:
- <absolute path of a file or folder this agent may change>
rules:
- <plugin folder>/templates/standing-rules.md
- <plugin folder>/principles.md
ril: <the exact command that runs ril>
report: agent-report
stop:
- <when to stop and report>
