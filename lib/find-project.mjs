import fs from 'node:fs';
import path from 'node:path';
import { statePath } from './store.mjs';

// The nearest folder at or above `start` that holds a ril project (.ril/state.json), or null.
export function findProject(start) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(statePath(dir))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}
