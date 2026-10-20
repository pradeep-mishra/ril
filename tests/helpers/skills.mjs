import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Splits `---` frontmatter (flat `key: value` lines) from the body.
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z-]+):\s*(.*?)\s*$/.exec(line);
    if (field) frontmatter[field[1]] = field[2];
  }
  return { frontmatter, body: text.slice(match[0].length) };
}

function readMarkdown(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return { file, text, ...parseFrontmatter(text), lines };
}

export const skillNames = () =>
  fs.readdirSync(path.join(repoRoot, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

export const roleNames = () =>
  fs.readdirSync(path.join(repoRoot, 'agents')).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3));

export const readSkill = (name) => readMarkdown(path.join(repoRoot, 'skills', name, 'SKILL.md'));
export const readRole = (name) => readMarkdown(path.join(repoRoot, 'agents', `${name}.md`));
export const readFile = (rel) => readMarkdown(path.join(repoRoot, rel));

// The group word after each `ril ` inside inline code or a fenced block.
export function rilCommandsIn(text) {
  const code = [];
  const rest = text.replace(/```[\s\S]*?```/g, (block) => {
    code.push(block);
    return '';
  });
  for (const m of rest.matchAll(/`([^`\n]+)`/g)) code.push(m[1]);
  const groups = [];
  for (const span of code) {
    for (const m of span.matchAll(/(?<![\w/-])ril\s+([a-z][a-z-]*)/g)) groups.push(m[1]);
  }
  return groups;
}

// The command groups the real CLI lists in `ril help --json`.
export function helpGroups() {
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'ril'), 'help', '--json'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ril help --json failed: ${r.stderr}`);
  return JSON.parse(r.stdout).commands.map((c) => c.name);
}

// `## ` headings of a body, in order.
export const headings = (body) => [...body.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1]);
