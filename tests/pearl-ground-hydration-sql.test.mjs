import { fixture, groundHydrationContract } from './helpers/pearl-ground-hydration-contract.mjs';
import { database } from './helpers/pearl-batch-journal-sql.mjs';

groundHydrationContract((options) => fixture({ ...options, backend: () => database() }));
