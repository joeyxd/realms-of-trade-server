import { replacementContract } from './helpers/pearl-replace-staging-contract.mjs';
import { fixture } from './helpers/pearl-replace-staging.mjs';

replacementContract((options) => fixture(options));
