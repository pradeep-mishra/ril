// Reading and checking a recipe folder's recipe.json.
import fs from 'node:fs';
import path from 'node:path';
import { RilError } from './errors.mjs';

const FIX = 'fix recipe.json (it is described in the plugin documentation), or ask whoever wrote the recipe';

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Returns the first problem found in a parsed recipe, or '' when it is fine.
function problem(r) {
  if (!isObject(r)) return 'it must hold one JSON object';
  if (!isText(r.name)) return 'it needs a "name"';
  if (!Array.isArray(r.requires)) return 'it needs a "requires" list';
  for (const [i, t] of r.requires.entries()) {
    const at = `requires item ${i + 1}`;
    if (!isObject(t)) return `${at} must be an object`;
    if (!isText(t.name)) return `${at} needs a "name"`;
    if (!isText(t.detect)) return `${at} (${t.name}) needs a "detect" command`;
    if (!isText(t.guide)) return `${at} (${t.name}) needs a plain-language "guide"`;
    if (t.human !== undefined && typeof t.human !== 'boolean') return `${at} (${t.name}): "human" must be true or false`;
    if (t.install !== undefined && (!isObject(t.install) || !Object.values(t.install).every((c) => c === null || isText(c)))) {
      return `${at} (${t.name}): "install" must map a platform to a command or null`;
    }
  }
  if (r.allowlist !== undefined) {
    const claude = isObject(r.allowlist) ? r.allowlist.claude : undefined;
    if (claude !== undefined && !(Array.isArray(claude) && claude.every(isText))) return '"allowlist.claude" must be a list of permission entries';
  }
  return '';
}

// Loads <given>/recipe.json (given is relative to `cwd`). A missing folder or file exits 2; a bad file exits 1.
export function loadRecipe(given, cwd) {
  if (!given) throw new RilError('Which recipe? No recipe folder was given.', { next: 'give the recipe folder, for example recipes/cli' });
  const dir = path.resolve(cwd, given);
  const file = path.join(dir, 'recipe.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw new RilError(`There is no recipe.json in ${dir}.`, { code: 2, next: 'check the folder; the recipes that ship with ril are in its recipes folder' });
    throw new RilError(`Could not read ${file}.`, { next: 'check the file can be read, then try again', detail: err.message });
  }
  let recipe;
  try {
    recipe = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new RilError(`${file} is not valid JSON.`, { next: FIX, detail: err.message });
  }
  const why = problem(recipe);
  if (why) throw new RilError(`${file} is not a usable recipe: ${why}.`, { next: FIX });
  return { dir, recipe };
}
