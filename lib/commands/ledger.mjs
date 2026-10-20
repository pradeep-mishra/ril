import fs from 'node:fs';
import path from 'node:path';
import { RilError } from '../errors.mjs';
import { REVIEWS, VERDICTS } from '../schema.mjs';
import { load, mutate } from '../store.mjs';
import { acceptedRisk, dispatch, find, logDecision, need, oneId, oneOf, say } from '../records.mjs';
import { parseFlags } from '../args.mjs';
import { changedFiles, head, isAncestor, looksLikeId, projectPrefix, resolve, unsavedFiles } from '../git.mjs';
import { checkEvidence, kitTrust, passes, realChanges } from '../proof.mjs';
import { sealState } from '../seal.mjs';

const RECORD = `ril ledger record <scenario> <checkpoint> <${VERDICTS.join('|')}> --evidence <path> --verifier <agent> --review ${REVIEWS.join('|')} --checks <n>`;
const CHECK = 'ril ledger check <scenario> <checkpoint>';
const CARRY = 'ril ledger carry <scenario> <from> <to>';
const SELFRUN = 'ril ledger selfrun <saved version> --break <evidence> --restored <evidence> --verifier <agent>';
const USAGE = `${RECORD} | ${CHECK} | ${CARRY} | ${SELFRUN} | ril ledger summary`;
const AGAIN = (id) => `ask a verifier agent to check scenario ${id} on the current saved version, then record it with ril ledger record`;
const SAVE_FIRST = 'run ril checkpoint, check that version, then record the result';

const short = (id) => id.slice(0, 7);

// A result must describe the saved version, so nothing in the project (outside .ril) may be unsaved.
function refuseUnsaved(dir) {
  const own = `${projectPrefix(dir)}.ril/`;
  const files = unsavedFiles(dir).filter((f) => !f.startsWith(own));
  if (!files.length) return;
  const named = files.slice(0, 5).join(', ') + (files.length > 5 ? ` and ${files.length - 5} more` : '');
  throw new RilError(`The project has changes that are not saved yet (${named}), so a result would not describe the saved version.`, { next: SAVE_FIRST });
}

// The full id of the current saved version, when `given` names it.
function currentVersion(dir, given) {
  if (!looksLikeId(given)) throw new RilError(`${JSON.stringify(given ?? '')} is not the id of a saved version.`, { next: 'use the id that ril checkpoint printed (at least 7 characters)' });
  const now = head(dir);
  if (!now) throw new RilError('Nothing has been saved in this project yet, so there is no version to check against.', { next: SAVE_FIRST });
  if (!now.startsWith(given.toLowerCase())) {
    throw new RilError(`${given} is not the current saved version (that is ${short(now)}), so this result would describe older code.`, { next: 'check the scenario again on the current saved version, then record that result' });
  }
  return now;
}

// Rail 1b: the protected files must be exactly as the last seal left them.
function refuseChangedSeal(dir, version, seals) {
  const { sealed, declared, outside, changed } = sealState(dir, version, seals);
  const restore = 'have a fresh tester restore the sealed files, then run ril checkpoint and check the scenario again';
  if (outside.length) throw new RilError(`These protected paths are outside the project: ${outside.join(', ')}.`, { next: 'name only paths inside the project on the Protected line of verify.md' });
  if (declared.length && !sealed) throw new RilError(`The protected files (${declared.join(', ')}) are not sealed yet, so a proof would not show they were left alone.`, { next: 'once the tester has finished, run ril checkpoint --seal, then check the scenario again' });
  if (changed.length) throw new RilError(`The protected files changed since the last seal (${changed.join(', ')}), so a proof would not describe the tests as the tester wrote them.`, { next: restore });
}

// The registered verifier that may record results.
function theVerifier(s, id) {
  const agent = s.agents.find((a) => a.id === id);
  if (agent?.role !== 'verifier') {
    throw new RilError(agent ? `Agent ${id} is a ${agent.role}, and only a verifier may record a result.` : `There is no agent called ${id}.`, { next: 'register a verifier agent with ril agent register and let it check the scenario' });
  }
  if (['failed', 'stopped'].includes(agent.state)) {
    throw new RilError(`Verifier ${id} has ${agent.state}, so its results cannot be recorded.`, { next: 'register a new verifier agent and let it check the scenario again' });
  }
  return agent;
}

function count(value, proving) {
  if (value === undefined) {
    if (proving) throw new RilError('A pass needs the number of checks that ran, and --checks is missing.', { next: `run: ${RECORD}` });
    return 0;
  }
  if (!/^\d+$/.test(value)) throw new RilError(`--checks must be a whole number, not ${JSON.stringify(value)}.`, { next: 'give the number of checks the verify command reported' });
  const n = Number(value);
  if (proving && n < 1) throw new RilError('A pass where no checks ran proves nothing.', { next: 'make the verify command run the checks for this scenario, then record again' });
  return n;
}

function upsert(ledger, row) {
  const at = ledger.findIndex((r) => r.scenario === row.scenario && r.checkpoint === row.checkpoint);
  if (at === -1) ledger.push(row);
  else ledger[at] = row;
}

// Rail 1: a scenario becomes proven only through this record, made by a verifier at the current saved version.
function record(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['evidence', 'verifier', 'review', 'checks'] });
  const id = oneId(rest, 'scenario', RECORD);
  if (rest.length !== 3) throw new RilError('ril ledger record needs a scenario, a saved version and a verdict.', { next: `run: ${RECORD}` });
  const verdict = oneOf(rest[2], VERDICTS, 'verdict');
  const proving = verdict.startsWith('proven-');
  const review = oneOf(need(flags, 'review', RECORD), REVIEWS, 'review result');
  const verifier = need(flags, 'verifier', RECORD);
  const evidence = need(flags, 'evidence', RECORD);
  const checks = count(flags.checks, proving);
  const trust = verdict === 'blocked' ? null : kitTrust(ctx.dir, load(ctx.dir).selfruns);
  if (trust === 'none') {
    throw new RilError('The proof kit has not been written yet (.ril/docs/verification/verify.md is missing), so only a blocked result can be recorded.', { next: `write the proof kit, then show it catching a deliberately broken version (${SELFRUN}), make "Trusted: yes (<saved version>)" the first line of verify.md, and check the scenario again` });
  }
  if (trust === 'untrusted' || trust === 'unshown') {
    const why = trust === 'unshown' ? 'it has not shown that it can fail: no recorded self-run matches the version on its first line' : 'the first line of its verify.md does not say "Trusted: yes (<saved version>)"';
    throw new RilError(`The verification kit is not trusted yet (${why}), so only a blocked result can be recorded.`, { next: `show the kit catching a deliberately broken version and passing once restored, record it with ${SELFRUN}, make "Trusted: yes (<saved version>)" the first line of verify.md, then check the scenario again` });
  }
  const checkpoint = currentVersion(ctx.dir, rest[1]);
  refuseUnsaved(ctx.dir);
  const stored = checkEvidence(ctx.dir, evidence, id);
  let status;
  mutate(ctx.dir, (s) => {
    const scenario = find(s.scenarios, id, 'scenario', 'ril scenario list');
    const agent = theVerifier(s, verifier);
    if (agent.unit !== id) throw new RilError(`Verifier ${verifier} was registered for ${agent.unit}, not for scenario ${id}, so it cannot record a result for it.`, { next: `register a verifier agent for scenario ${id} with ril agent register --unit ${id}, and let it check the scenario` });
    const existing = s.ledger.find((r) => r.scenario === id && r.checkpoint === checkpoint);
    if (verdict === 'blocked' && existing && passes(existing)) {
      throw new RilError(`Scenario ${id} already passed at this saved version, so a blocked result cannot replace that pass.`, { next: 'if the scenario now fails, record failed with its evidence; if the environment broke, fix it and check again' });
    }
    if (verdict === 'blocked' && existing?.verdict === 'failed') {
      throw new RilError(`Scenario ${id} already failed at this saved version, so a blocked result cannot replace that failure.`, { next: 'fix the failure, save a new version with ril checkpoint and check it again; if the environment broke, fix it first' });
    }
    if (proving) {
      refuseChangedSeal(ctx.dir, checkpoint, s.seals);
      const method = verdict.slice('proven-'.length);
      if (method !== scenario.method) throw new RilError(`Scenario ${id} is proven by ${scenario.method}, not by ${method}.`, { next: `check it the ${scenario.method} way and record proven-${scenario.method}` });
      if (review === 'none') throw new RilError(`Scenario ${id} cannot pass without a review.`, { next: 'have a reviewer look at it, then record the review result' });
      if (review === 'risks' && !acceptedRisk(s.decisions, id)) {
        throw new RilError(`The review found risks in scenario ${id} and nobody has accepted them.`, { next: `fix them, or have the person accept them with ril decision log --decision "Accepted risk for ${id}: <what>", then record again` });
      }
      scenario.status = 'proven';
    } else if (verdict === 'failed') {
      scenario.status = 'failing';
    }
    scenario.updated = ctx.now().toISOString();
    status = scenario.status;
    upsert(s.ledger, { scenario: id, checkpoint, verdict, review, checks, evidence: stored, verifier, ts: ctx.now().toISOString() });
  });
  const text = verdict === 'blocked' ? `Recorded that scenario ${id} could not be checked; it is still ${status}.` : `Recorded ${verdict} for scenario ${id} at saved version ${short(checkpoint)}; it is now ${status}.`;
  say(ctx, text, { scenario: id, checkpoint, verdict, status });
}

// Rail 1c: a proof kit is trusted only after a verifier recorded that it failed on a deliberately broken copy
// and passed once restored (two different evidence files).
function selfrun(ctx, argv) {
  const { flags, rest } = parseFlags(argv, { values: ['break', 'restored', 'verifier'] });
  if (rest.length !== 1) throw new RilError('ril ledger selfrun needs the saved version the kit was run on.', { next: `run: ${SELFRUN}` });
  const [version, verifier] = [currentVersion(ctx.dir, rest[0]), need(flags, 'verifier', SELFRUN)];
  const [breakEvidence, restoredEvidence] = ['break', 'restored'].map((name) => checkEvidence(ctx.dir, need(flags, name, SELFRUN), 'kit'));
  const bytes = (file) => fs.readFileSync(path.join(ctx.dir, file));
  if (breakEvidence === restoredEvidence || bytes(breakEvidence).equals(bytes(restoredEvidence))) {
    throw new RilError('The break evidence and the restored evidence are the same, so they cannot show a failure and then a pass.', { next: 'save the broken-copy run and the restored run as two different files under .ril/evidence/kit/<saved version>/, then record again' });
  }
  mutate(ctx.dir, (s) => {
    theVerifier(s, verifier);
    (s.selfruns ??= []).push({ version, breakEvidence, restoredEvidence, verifier, ts: ctx.now().toISOString() });
  });
  say(ctx, `Recorded the kit self-run at saved version ${short(version)}. Now make "Trusted: yes (${short(version)})" the first line of verify.md.`, { version, breakEvidence, restoredEvidence });
}

function notVerified(id, why) {
  return new RilError(`NOT-VERIFIED: ${why}`, { code: 2, next: AGAIN(id) });
}

function check(ctx, argv) {
  const { rest } = parseFlags(argv);
  const id = oneId(rest, 'scenario', CHECK);
  const given = rest[1];
  if (!looksLikeId(given)) throw new RilError(`${JSON.stringify(given ?? '')} is not the id of a saved version.`, { next: `run: ${CHECK}` });
  const state = load(ctx.dir);
  const scenario = find(state.scenarios, id, 'scenario', 'ril scenario list');
  if (scenario.status !== 'proven') throw notVerified(id, `scenario ${id} is ${scenario.status}, so no earlier pass counts.`);
  const row = state.ledger.find((r) => r.scenario === id && r.checkpoint.startsWith(given.toLowerCase()) && passes(r));
  if (!row) throw notVerified(id, `scenario ${id} has no pass recorded at saved version ${given}.`);
  say(ctx, `VERIFIED: scenario ${id} passed at saved version ${short(row.checkpoint)} (${row.checks} checks, review ${row.review}).`, { verified: true, ...row });
}

// Copies a pass to a later saved version when only tests, docs or ril's own files changed in between.
function carry(ctx, argv) {
  const { rest } = parseFlags(argv);
  const id = oneId(rest, 'scenario', CARRY);
  if (rest.length !== 3) throw new RilError('ril ledger carry needs a scenario and two saved versions.', { next: `run: ${CARRY}` });
  const [from, to] = rest.slice(1).map((given) => {
    const full = resolve(ctx.dir, given);
    if (!full) throw new RilError(`There is no saved version called ${given}.`, { code: 2, next: 'use ids that ril checkpoint printed' });
    return full;
  });
  if (!isAncestor(ctx.dir, from, to)) {
    throw new RilError(`Saved version ${short(to)} is not built on ${short(from)}, so a pass cannot be carried to it.`, { next: AGAIN(id) });
  }
  const { method } = find(load(ctx.dir).scenarios, id, 'scenario', 'ril scenario list');
  const changed = changedFiles(ctx.dir, from, to);
  const real = realChanges(changed, projectPrefix(ctx.dir), method);
  mutate(ctx.dir, (s) => {
    const scenario = find(s.scenarios, id, 'scenario', 'ril scenario list');
    const row = s.ledger.find((r) => r.scenario === id && r.checkpoint === from && passes(r));
    if (scenario.status !== 'proven' || !row) throw notVerified(id, `scenario ${id} has no current pass at saved version ${short(from)} to carry forward.`);
    if (real.length) {
      throw new RilError(`NOT-TRIVIAL: these files changed between the two saved versions, so scenario ${id} must be checked again: ${real.join(', ')}`, { code: 2, next: AGAIN(id) });
    }
    upsert(s.ledger, { ...row, checkpoint: to, ts: ctx.now().toISOString() });
    logDecision(s, ctx, `Carried the pass for scenario ${id} from saved version ${short(from)} to ${short(to)}`, `only tests, docs or ril files changed (${changed.length} files)`);
  });
  say(ctx, `Scenario ${id} stays proven at saved version ${short(to)}: only tests, docs or ril files changed.`, { scenario: id, from, to, changed });
}

function summary(ctx) {
  const { scenarios, ledger } = load(ctx.dir);
  const rows = scenarios.map((s) => {
    const mine = ledger.filter((r) => r.scenario === s.id);
    return { id: s.id, status: s.status, method: s.method, records: mine.length, latest: mine.at(-1) ?? null };
  });
  if (ctx.json) return ctx.out(JSON.stringify({ scenarios: rows, records: ledger.length }));
  if (!rows.length) return ctx.out('There are no scenarios yet, so nothing has been checked.');
  for (const r of rows) {
    const last = r.latest ? `last result ${r.latest.verdict} at saved version ${short(r.latest.checkpoint)} (${r.latest.checks} checks, review ${r.latest.review})` : 'never checked';
    ctx.out(`${r.id}  ${r.status}  ${last}`);
  }
}

export default {
  name: 'ledger',
  summary: 'Record and check verification results for each saved version.',
  usage: USAGE,
  run: (ctx, argv) => dispatch(ctx, argv, 'ledger', { record, check, carry, selfrun, summary }),
};
