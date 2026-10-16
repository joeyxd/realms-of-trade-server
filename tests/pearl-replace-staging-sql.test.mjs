import { replacementContract } from './helpers/pearl-replace-staging-contract.mjs';
import { fixture } from './helpers/pearl-replace-staging.mjs';
import { database } from './helpers/pearl-batch-journal-sql.mjs';

replacementContract((options) => fixture({ ...options, backend: () => database() }));
