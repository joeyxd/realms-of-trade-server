import { startupFixture, pearlStartupContract } from './helpers/pearl-startup-contract.mjs';
import { database } from './helpers/pearl-batch-journal-sql.mjs';

pearlStartupContract((options) => startupFixture({ ...options, backend: () => database() }));
