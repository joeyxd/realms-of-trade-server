import { startupFixture, pearlStartupContract } from './helpers/pearl-startup-contract.mjs';

pearlStartupContract((options) => startupFixture(options));
