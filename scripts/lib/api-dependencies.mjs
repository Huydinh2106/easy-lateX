import { createRequire } from 'node:module';

// npm can install a workspace dependency inside apps/api/node_modules instead
// of hoisting it to the repository root. Resolve operator-script dependencies
// from the API package that actually declares them.
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
export const { Pool } = require('pg');
export const { config } = require('dotenv');
