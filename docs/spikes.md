# Milestone 0 spikes

Three questions only a real run could answer. Run on 2026-10-19 with Claude Code 2.1.304 on macOS (Darwin), non-interactive (`claude -p`), from a scratch plugin kept outside this repo. `<S>` below stands for the scratch directory.

Confidence labels: **measured** = observed in a real run; **documented** = taken from the Claude Code docs (code.claude.com/docs, pages `settings`, `permissions`, `plugins-reference`) and not run; **inferred** = reasoned from measured and documented facts; **guess** = no evidence.

Scratch plugin layout (`<S>/p1`):

```
.claude-plugin/plugin.json      {"name":"ril","version":"0.0.1","description":"spike"}
commands/ril.md                 "Reply with exactly the word PONG-COMMAND"
skills/ril/SKILL.md             "Reply with exactly the word PONG-SKILL"
skills/probe/SKILL.md           S3 probe (Bash steps, see S3)
agents/opusagent.md             model: opus, tools: Bash
bin/ril-s3.mjs                  prints its own absolute path (chmod +x, node shebang)
bin/ril                         prints "RIL-BARE ok <args>" (chmod +x, node shebang)
```

Every `claude -p` run used `--plugin-dir <S>/p1` (or a copy with one file removed) and was started with cwd `<S>/cwd`, outside any repo.

## S1

**Question.** Does a bare `/ril` need `commands/ril.md`, or does `skills/ril/SKILL.md` give it?

**Tried.** Plugin name `ril`; one skill named `ril`; one command file `ril.md`. Three plugin variants (both files; skill only; command only), each driven with the two prompts `/ril` and `/ril:ril`:

```
claude -p "/ril"     --plugin-dir <S>/p1 --permission-mode acceptEdits --output-format text
claude -p "/ril:ril" --plugin-dir <S>/p1 --permission-mode acceptEdits --output-format text
```

(`<S>/p2` is `p1` minus `commands/ril.md`; `<S>/p3` is `p1` minus `skills/ril/`.)

**Observed.**

| Plugin has | `/ril` | `/ril:ril` |
| --- | --- | --- |
| skill + command | `PONG-SKILL` (skill wins) | `PONG-COMMAND` (command wins) |
| skill only | `PONG-SKILL` | `PONG-SKILL` |
| command only | not recognised: "`/ril` isn't a command in this session, so nothing ran" (it listed `/ril:ril` as the namespaced command) | `PONG-COMMAND` |

**Decision.** A skill named like the plugin (`skills/ril/SKILL.md`) is enough for both `/ril` and `/ril:ril`. `commands/ril.md` is not needed, and keeping it would be harmful: it would take over `/ril:ril` while the skill keeps `/ril`, so the two forms would run different things. Task 9 therefore makes the front door `skills/ril/SKILL.md` only and creates no `commands/ril.md`. A command file alone does not give bare `/ril`.

**Confidence.** Measured, in `-p` mode. Typing `/ril` into an interactive prompt was not run here (no interactive terminal). Whether interactive resolution matches `-p` is an assumption (inferred, not run), so the owner should type `/ril` once in a real session after Task 9 to confirm.

## S2

**Question.** Exact `permissions.allow` forms for a shell prefix and for a path in project `.claude/settings.json`; whether entries merge with the user's file; whether `model: opus` in an agent file works.

### Allowlist entry forms

**Documented** (permissions page, "Permission rule syntax"):

- Shell prefix: `Bash(ril *)`. A trailing ` *` (space then star) matches the command plus any arguments and also the bare command `ril`; the space is part of the rule, so `Bash(ril*)` would also match `rilx`. `Bash(ril:*)` is an equivalent older spelling. Put the `*` after the subcommand; a `*` before the subcommand draws a startup warning.
- Compound commands: a rule must match each subcommand separately (`&&`, `||`, `;`, `|`, `&`, newline are the separators). A rule `Bash(ril *)` does not approve `ril x && other-cmd`.
- A prefix rule matches the command as typed. `Bash(curl *)` does not match `/usr/bin/curl ...` or `sh -c '...'`. Wrappers `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin` are stripped before matching; runners such as `npx` and `node script` are not.
- Paths use `Edit(...)` and `Read(...)` only. `Write(...)` and `NotebookEdit(...)` rules are accepted but never consulted. Forms: `//abs/path/**` (absolute from filesystem root), `~/path/**` (home), `/path/**` (relative to the project root for project settings), `path/**` or `./path/**` (relative to the current directory). Bare `src/**` as an allow rule matches only `<cwd>/src`.
- Project `.claude/settings.json` `permissions.allow` entries only take effect after the folder is trusted (interactive trust dialog). `deny` and `ask` rules apply at once.
- Lists merge across scopes: "When you set the same list key, such as `permissions.allow`, in more than one file, Claude Code combines the lists." Project entries add to the user's; they do not replace them. A `deny` in any scope beats an `allow` in any other.

**Measured** (all with `--setting-sources` limited so the user's own allow rules could not mask the result):

1. `--allowedTools "Bash(ril *)"`, mode `default`, user settings not loaded:
   - `ril ping` ran (`RIL-BARE ok ping`).
   - `touch zz-test-file` blocked: "needs approval".
   - `ril ping && touch zz2` blocked on the `touch` part; `ril ping` printed nothing before the block.
   - `node <S>/p1/bin/ril ping` blocked: "This command requires approval". So `Bash(ril *)` covers only the bare `ril` spelling.
2. A project `.claude/settings.json` with `{"permissions":{"allow":["Bash(ril *)","Edit(/.ril/**)"]}}` in an untrusted folder, run with `claude -p ... --setting-sources project`:
   ```
   Ignoring 2 permissions.allow entries from .claude/settings.json: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog, or set projects["<path>"].hasTrustDialogAccepted: true in /Users/<user>/.claude.json.
   ```
   All calls were then blocked. So in `claude -p` (and in any headless test of the plugin), project allow rules do nothing until the folder has been trusted once. I did not edit `~/.claude.json` to test the trusted case.
3. Same entry syntax loaded through `--settings <file>` (which skips the trust step), mode `default`:
   - `Bash(ril *)` allowed `ril ping`.
   - `Edit(.ril/**)`, `Edit(./docs/**)` and `Edit(//<abs>/proj/abs/**)` each allowed the Write tool to create a file at the matching path (so an `Edit(...)` rule does cover the Write tool). The `//<abs>` form (absolute from the filesystem root) is therefore measured, via `--settings`. A path that matched no rule (`other/a.txt`) was refused. All of these ran with the session started in the project root.
   - `Edit(/.ril/**)` allowed `.ril/b.txt` when the settings file was at the project root (`s3.json`), but did not when the same file was passed from `.claude/settings.json`. This fits the doc line that a leading `/` is "relative to the settings source", and it is only unexplained for `--settings` files inside `.claude/`. For a real project `.claude/settings.json` the docs say it anchors at the project root; I could not verify that without trust, so treat the leading-`/` form as **documented, not measured** and prefer the cwd-relative form below. Note the `--settings` file is not the same load path as a project `.claude/settings.json` (it skips the trust step), so none of the path results here prove how the project file anchors.

**Decision (allowlist forms for the project's `.claude/settings.json`).**

```json
{
  "permissions": {
    "allow": [
      "Bash(ril *)",
      "Edit(.ril/**)"
    ]
  }
}
```

Use `Bash(ril *)` for the CLI, `Edit(.ril/**)` for the state directory. Label: `Edit(.ril/**)` is measured via `--settings`; its behaviour from a project `.claude/settings.json` is documented only. Caveat: a cwd-relative rule is anchored at the directory Claude Code was launched from (documented), so if Claude Code is started from a subdirectory the rule stops covering the project's `.ril/` and prompts return. **Owner re-check:** in a trusted project, confirm that a Write to `.ril/x` is allowed without a prompt (a) when Claude Code is started from the project root and (b) when it is started from a subfolder; if (b) fails, switch to the documented `Edit(/.ril/**)` form and repeat the check. Do not use `Write(...)`. Because of the trust rule, the shipped setup must tell the owner to run Claude Code interactively in the project once and accept the trust dialog; nothing in `-p` can do it. Because project entries merge with the owner's own file and do not replace it, the setup may add its entries without removing anything the owner already allows. Note (later): the shipped base entry is now `Edit(./**)`, with deny entries for the state files.

**Confidence.** Measured: `Bash(ril *)` allows `ril ping` and does not allow compound or `node <path>` forms; cwd-relative and `//<abs>` `Edit` forms via `--settings`; the untrusted-project ignore message. Documented only, not run: that a trailing ` *` also matches bare `ril` with no arguments; project-file path anchoring (cwd-relative and leading-`/`); `~/` anchoring; merging across scopes; the wrapper-stripping list.

### `model: opus` in an agent file

**Tried.** `agents/opusagent.md` with frontmatter `model: opus`, `tools: Bash`, loaded from the plugin and called by the main (Sonnet) session:

```
claude -p "Use the Agent tool with subagent_type ril:opusagent to do its task, then print its answer." \
  --plugin-dir <S>/p1 --permission-mode acceptEdits --allowedTools "Bash" \
  --output-format stream-json --verbose
```

**Observed.** The init event listed the agent as `ril:opusagent`. The main session's assistant messages carried `model: claude-sonnet-5-5`. The assistant message produced inside the subagent (the one with a `parent_tool_use_id`) carried `model: claude-opus-5-5`. The subagent ran its Bash command and returned the output.

**Decision.** `model: opus` in an agent's frontmatter works on this plan and selects the Opus model for that worker, independent of the session model. Plugin agents are addressed as `ril:<agent-name>`. Use it for the proof-critical roles.

**Confidence.** Measured. This only shows the alias resolves on this account today; if a later plan has no Opus access the alias will fail or fall back, so the plugin should not assume it for correctness.

## S3

**Question.** In a loaded session, is the plugin's `bin/` on `PATH` for Bash calls, and does a skill see `${CLAUDE_PLUGIN_ROOT}`?

**Tried.** A probe skill whose text told the model to run, with the Bash tool: the env check, the bare script, and the absolute-path form, and to quote the plugin-root text it was given:

```
claude -p "/ril:probe" --plugin-dir <S>/p1 --permission-mode acceptEdits --allowedTools "Bash" --output-format text
```

Probe steps: (1) `echo "ROOT_ENV=[$CLAUDE_PLUGIN_ROOT]"; echo "PATH=$PATH"; command -v ril-s3.mjs || echo NOT_ON_PATH`; (2) report the skill-text value `[${CLAUDE_PLUGIN_ROOT}]`; (3) run bare `ril-s3.mjs`; (4) run `node "${CLAUDE_PLUGIN_ROOT}/bin/ril-s3.mjs"`.

**Observed (trimmed).**

```
ROOT_ENV=[]
PATH=/Applications/.../bin:...:<S>/p1/bin          <- plugin bin/ is the LAST PATH entry
<S>/p1/bin/ril-s3.mjs                              <- command -v found it
skill-text value: <S>/p1               <- ${CLAUDE_PLUGIN_ROOT} was replaced by a real absolute path
bare:   RIL-S3 path=<S>/p1/bin/ril-s3.mjs          <- ran, no error
node:   RIL-S3 path=<S>/p1/bin/ril-s3.mjs          <- identical
```

A subagent defined by the plugin also ran bare `ril hello` and got `RIL-BARE ok hello` (it printed `ROOT=[]` for `$CLAUDE_PLUGIN_ROOT`), so workers see the same `PATH` and the same empty variable as the main session. The docs agree: the path variables "aren't present in the environment of commands Claude runs through the Bash tool, in the main session or in a subagent", and `${CLAUDE_PLUGIN_ROOT}` is substituted inline in skill, command and agent Markdown bodies.

**Decision.**

- Command prefix on macOS: bare `ril <args>`. It needs `bin/ril` to be executable (`chmod +x`, committed with mode 755) and to start with `#!/usr/bin/env node`. No `node` prefix, no path.
- Do not rely on `$CLAUDE_PLUGIN_ROOT` inside a Bash command; it is empty there. If a path is ever needed, write `${CLAUDE_PLUGIN_ROOT}` in the skill or agent text and let Claude Code substitute it (measured), e.g. `node "${CLAUDE_PLUGIN_ROOT}/bin/ril" <args>`. That form is a fallback only, because the allowlist cannot cover an install-specific absolute path without a broad `node` rule (S2 measured that `Bash(ril *)` does not match the `node <path>` form).
- `bin/` is appended last on `PATH`, so a different `ril` installed earlier on the user's `PATH` would shadow ours. `command -v ril` in the setup step can detect that.
- Windows (**guess**, not run; needs a Windows run by the owner): the claude-code docs pages used here (`plugins-reference`: "Files here [in `bin/`] are on the Bash tool's `PATH` while the plugin is enabled", and "On Windows, the substituted paths use forward slashes"; `permissions`: has a separate PowerShell rule section) say nothing that confirms a bare extensionless script runs on Windows. Open points: (a) Claude Code on Windows may run commands through a non-Bash shell (PowerShell), in which case `Bash(ril *)` is irrelevant and a different rule form and a runnable file name (e.g. `ril.cmd` or `ril.ps1`) would be needed; (b) if Bash is Git Bash, it may pick the extensionless `ril` shebang script over a `ril.cmd` next to it, or fail to run it, because shebang handling and the executable bit are not reliable on NTFS; (c) `node` must be on that shell's `PATH`. A candidate to try is a second file `bin/ril.cmd` (`@node "%~dp0ril" %*`) with the fallback `node "${CLAUDE_PLUGIN_ROOT}/bin/ril"`; the forward-slash substitution is documented on the page above but was not run. Do not claim Windows support until the owner has run `ril` from a loaded session on Windows.

**Confidence.** macOS bare-`ril`, `PATH` position, empty env var, and skill-text substitution: measured, but every run used `--plugin-dir <scratch>`, not a plugin installed from a marketplace or the plugin cache. `PATH` handling and the `${CLAUDE_PLUGIN_ROOT}` value (the install path moves with version, per the docs) may differ after a real install, so "reliably" is established only for `--plugin-dir`. **Owner re-check:** after installing the real plugin, run bare `ril --help` (or `command -v ril`) once from a Bash call in a session and confirm the plugin's `bin/` is on `PATH`. Windows: guess (see above).

## Decisions for later tasks

1. **Bare `/ril` and `commands/ril.md`.** Not needed. Front door is `skills/ril/SKILL.md` with plugin name `ril`; that gives `/ril` and `/ril:ril`. Do not create `commands/ril.md` (it would take over `/ril:ril`). Interactive confirmation of `/ril` still owed (S1).
2. **Manifest keys for skills and agents.** None needed. `.claude-plugin/plugin.json` with just `name`, `version`, `description` (and `author`, to avoid the validator's one warning) is enough: the default `skills/<name>/SKILL.md` and `agents/<name>.md` are found (measured: with a manifest holding only `name`, `version`, `description`, the session loaded skills `ril` and `probe` and listed agent `ril:opusagent`). `claude plugin validate <S>/p1` printed `Found 1 warning: author: No author information provided. Consider adding author details for plugin attribution` then `Validation passed with warnings` (measured; the missing `author` is the one warning, so adding `author` is expected to clear it, which was not re-run). If a key is ever wanted, the forms are `"skills": ["./skills/"]` (directories; adds to the default `skills/` scan) and `"agents": ["./agents/<name>.md", ...]` (individual `.md` files only, directories not accepted; replaces the default `agents/` scan), every path starting with `./`. Those forms and the add-versus-replace behaviour are **documented** (`plugins-reference`, Fields table and "How each key combines with its default location"); only the validate step was run: `claude plugin validate <S>/p4`, with `"skills":["./skills/"],"agents":["./agents/opusagent.md"]` in the manifest, printed the same single `author` warning and `Validation passed with warnings`. A session loading those explicit keys was not run. Prefer to omit them.
3. **Allowlist entries (project `.claude/settings.json`).** `"Bash(ril *)"` and `"Edit(.ril/**)"` under `permissions.allow` (the `Edit` form measured via `--settings` only; see S2 for the subfolder caveat and owner re-check). No `Write(...)` entries. Entries merge with the user's own settings (documented, not run). They only take effect once the owner has accepted the workspace trust dialog in an interactive session; in `claude -p` they are ignored with the message quoted in S2. Note (later): the shipped base entry is now `Edit(./**)`, with deny entries for the state files.
4. **`model: opus` in an agent file.** Works on this plan (measured): the subagent ran as the Opus model while the session ran Sonnet. Agents are named `ril:<name>`.
5. **Command prefix to run the CLI.** macOS: bare `ril <args>` (plugin `bin/` is on the Bash `PATH`; the file must be executable with a node shebang). This is the string `ril-control` puts in each brief's `ril:` field. `$CLAUDE_PLUGIN_ROOT` is empty in Bash; `${CLAUDE_PLUGIN_ROOT}` is substituted only in skill and agent text. Windows (guess, untested): unresolved; see S3, including the possibility that the shell is not Bash. Verified for `--plugin-dir` loading only, not an installed plugin.
