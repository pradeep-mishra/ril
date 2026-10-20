import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The folder that holds skills/, bin/ and lib/: one level above this file's folder.
export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
