#!/usr/bin/env node
import { register } from 'tsx/esm/api';

/**
 * The entry point. Everything it does is get TypeScript running and hand over.
 *
 * This repository has no build step: the source is run through tsx by every
 * script in package.json, and the imports inside src/ are extensionless, which
 * Node's own resolver will not follow. So tsx is registered here before the
 * first import of src/, and the import is dynamic because a static one would be
 * hoisted above the register call and fail.
 *
 * The exit code is assigned rather than passed to process.exit, so that stdout
 * finishes flushing. A piped `lacuna ask ... --json | jq` loses its last chunk
 * otherwise.
 */

register();

const { main } = await import('../src/cli/main.ts');
process.exitCode = await main(process.argv.slice(2));
