import { fixture, deathDropHydrationContract } from './helpers/death-drop-hydration-contract.mjs';
import { database } from './helpers/death-drop-journal-sql.mjs';

deathDropHydrationContract((options) => fixture({ ...options, backend: () => database() }));
