// Reading and checking a recipe folder's recipe.json.
import fs from 'node:fs';
import path from 'node:path';
import { RilError } from './errors.mjs';
import { pluginRoot } from './plugin-root.mjs';

// Recipes that ship with ril. A recipe supplies shell commands that run on this machine and permissions that are
// granted without asking, and `ril` itself is pre-approved, so a recipe folder must never be one an agent could have
// written. Only a folder whose real path is inside this one is accepted, with no way around it.
// Project-local recipes for project types ril has no recipe for would need the person's explicit approval first;
// they are not supported in this milestone.
export const SHIPPED_RECIPES = path.join(pluginRoot, 'recipes');

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

const NOT_SHIPPED = (dir) => new RilError(`${dir} is not one of the recipes that ship with ril, so ril will not run its commands or grant its permissions.`, { next: 'only the recipes that ship with ril can be used here; for example recipes/cli in the ril folder' });

const realOrNull = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

// True when `real` is a real path strictly inside the real path of `root`.
function inside(root, real) {
  const rel = path.relative(root, real);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Quotes a folder path as one shell word for the platform's shell (double quotes on Windows, single quotes elsewhere).
export function shellQuote(text, platform = process.platform) {
  return platform === 'win32' ? `"${text}"` : `'${text.replaceAll("'", `'\\''`)}'`;
}

// Expands the literal token {recipe} in a detect command to the quoted recipe folder, so the author must not add
// quotes around it. Detect commands should prefer the environment variable RIL_RECIPE_DIR, which preflight also sets
// and which needs no quoting at all.
export const expandRecipe = (detect, dir, platform = process.platform) => detect.replaceAll('{recipe}', shellQuote(dir, platform));

// Loads <given>/recipe.json (given is relative to `cwd`). The folder and the file must both really be inside
// `trustedRoot` (only tests pass another one, through ctx.recipeRoot). A missing folder or file exits 2; a bad file exits 1.
export function loadRecipe(given, cwd, trustedRoot = SHIPPED_RECIPES) {
  if (!given) throw new RilError('Which recipe? No recipe folder was given.', { next: 'give the recipe folder, for example recipes/cli' });
  const asked = path.resolve(cwd, given);
  const dir = realOrNull(asked);
  if (dir === null) throw new RilError(`There is no recipe.json in ${asked}.`, { code: 2, next: 'check the folder; the recipes that ship with ril are in its recipes folder' });
  const root = realOrNull(trustedRoot);
  if (root === null || !inside(root, dir)) throw NOT_SHIPPED(asked);
  const file = path.join(dir, 'recipe.json');
  const realFile = realOrNull(file);
  if (realFile !== null && !inside(root, realFile)) throw NOT_SHIPPED(asked);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw new RilError(`There is no recipe.json in ${dir}.`, { code: 2, next: 'check the folder; the recipes that ship with ril are in its recipes folder' });
    throw new RilError(`Could not read ${file}.`, { next: 'check the file can be read, then try again', detail: err.message });
  }
  let recipe;
  try {
    recipe = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new RilError(`${file} is not valid JSON.`, { next: FIX, detail: err.message });
  }
  const why = problem(recipe);
  if (why) throw new RilError(`${file} is not a usable recipe: ${why}.`, { next: FIX });
  return { dir, recipe };
}
