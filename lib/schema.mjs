// The shape of .ril/state.json and the checks that keep it sound.

export const MODES = ['autonomous', 'guided'];
export const STAGES = ['shape', 'design', 'confirm', 'build', 'accept', 'done', 'parked'];
export const UNIT_KINDS = ['plan', 'task'];
export const UNIT_STATES = ['todo', 'doing', 'built', 'verified', 'failed', 'parked'];
export const METHODS = ['ui', 'api', 'cli', 'golden'];
export const SCENARIO_STATUSES = ['unproven', 'proven', 'failing', 'parked'];
export const VERDICTS = [...METHODS.map((m) => `proven-${m}`), 'failed', 'blocked'];
export const REVIEWS = ['clean', 'risks', 'none'];
export const AGENT_STATES = ['running', 'done', 'failed', 'stopped'];
export const GATE_STATUSES = ['open', 'resolved'];
export const CAP_MIN = 5;
export const CAP_MAX = 10;
export const CAP_DEFAULT = 8;

const LISTS = ['units', 'scenarios', 'ledger', 'agents', 'gates', 'decisions'];

// Callers pass { project, mode, now }; `now` is not stored because the state shape has no top-level timestamp.
export function emptyState({ project, mode } = {}) {
  return {
    version: 1,
    project,
    mode,
    stage: 'shape',
    parkedFrom: null,
    cap: CAP_DEFAULT,
    target: null,
    stack: null,
    recipe: null,
    pluginRoot: null,
    units: [],
    scenarios: [],
    ledger: [],
    agents: [],
    gates: [],
    decisions: [],
  };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (values) => values.join(', ');

function checkEnum(problems, where, field, value, allowed) {
  if (!allowed.includes(value)) {
    problems.push(`${where} ${field} is ${JSON.stringify(value)}; it must be one of: ${list(allowed)}`);
  }
}

function checkItems(problems, state, key, enums, { ids = true } = {}) {
  const seen = new Set();
  state[key].forEach((item, i) => {
    if (!isObject(item)) {
      problems.push(`${key} entry ${i + 1} is not an object`);
      return;
    }
    const where = ids ? `${key} entry ${JSON.stringify(item.id)}` : `${key} entry ${i + 1}`;
    if (ids) {
      if (typeof item.id !== 'string' || item.id === '') problems.push(`${key} entry ${i + 1} has no id`);
      else if (seen.has(item.id)) problems.push(`${key} has the id ${JSON.stringify(item.id)} more than once`);
      seen.add(item.id);
    }
    for (const [field, allowed] of Object.entries(enums)) checkEnum(problems, where, field, item[field], allowed);
  });
}

// Returns a list of plain-language problems; an empty list means the state is valid.
export function validate(state) {
  if (!isObject(state)) return ['the state is not a JSON object'];
  const problems = [];
  if (state.version !== 1) problems.push(`version is ${JSON.stringify(state.version)}; this ril reads version 1`);
  if (typeof state.project !== 'string' || state.project === '') problems.push('project name is missing');
  checkEnum(problems, 'the project', 'mode', state.mode, MODES);
  checkEnum(problems, 'the project', 'stage', state.stage, STAGES);
  if (state.stage === 'parked') {
    checkEnum(problems, 'the project', 'parkedFrom', state.parkedFrom, STAGES.filter((s) => s !== 'parked'));
  } else if (state.parkedFrom !== null) {
    problems.push(`parkedFrom is ${JSON.stringify(state.parkedFrom)}; it must be empty (null) unless the stage is parked`);
  }
  if (!Number.isInteger(state.cap) || state.cap < CAP_MIN || state.cap > CAP_MAX) {
    problems.push(`cap is ${JSON.stringify(state.cap)}; it must be a whole number from ${CAP_MIN} to ${CAP_MAX}`);
  }
  const missing = LISTS.filter((key) => !Array.isArray(state[key]));
  for (const key of missing) problems.push(`${key} must be a list`);
  if (missing.length) return problems;

  checkItems(problems, state, 'units', { kind: UNIT_KINDS, state: UNIT_STATES });
  checkItems(problems, state, 'scenarios', { method: METHODS, status: SCENARIO_STATUSES });
  checkItems(problems, state, 'ledger', { verdict: VERDICTS, review: REVIEWS }, { ids: false });
  checkItems(problems, state, 'agents', { state: AGENT_STATES });
  checkItems(problems, state, 'gates', { status: GATE_STATUSES });
  checkItems(problems, state, 'decisions', {}, { ids: false });
  return problems;
}
