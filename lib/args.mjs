// A small flag parser: --name value, --name=value, and true/false switches.
import { RilError } from './errors.mjs';

// spec: { values: ['dir'], bools: ['json'], keepUnknown: false }
// Returns { flags, rest }; `rest` holds the words that are not flags (and unknown flags when keepUnknown is set).
export function parseFlags(argv, { values = [], bools = [], keepUnknown = false } = {}) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || arg === '--') {
      rest.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (bools.includes(name) && eq === -1) {
      flags[name] = true;
    } else if (values.includes(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || (eq === -1 && value.startsWith('--'))) {
        throw new RilError(`The option --${name} needs a value.`, { next: `add a value after --${name}, or run ril help` });
      }
      flags[name] = value;
    } else if (keepUnknown) {
      rest.push(arg);
    } else {
      throw new RilError(`ril does not know the option ${arg}.`, { next: 'run ril help to see what is available' });
    }
  }
  return { flags, rest };
}
