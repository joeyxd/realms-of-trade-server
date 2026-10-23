export * from '../../server/agent/create-companion.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCreateCompanionCli } from '../../server/agent/create-companion.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCreateCompanionCli();
