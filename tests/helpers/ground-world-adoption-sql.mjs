import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { Economy } from '../../src/sim/economy/economy.js';
import { database as databaseBeforeAdoption, reopenDatabase as reopenAdoptedDatabase } from './ground-host-authority-sql.mjs';

const migration022 = () => readFile(new URL('../../server/migrations/022_fire_operations.sql', import.meta.url), 'utf8');
const migration023 = () => readFile(new URL('../../server/migrations/023_ground_world_adoption.sql', import.meta.url), 'utf8');

export const adoptionId = n => `a2300000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function worldSnapshot(tick = 500, seed = 91) {
  return { v: 1, seed, economy: new Economy(seed).serialize(), resources: { v: 1, tick,
    nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} } };
}

function adoptionClient(db) {
  const client = createClient('http://supabase.test', 'service-role-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init = {}) => {
      const name = new URL(input).pathname.split('/').at(-1), args = JSON.parse(init.body ?? '{}');
      try {
        const statements = {
          mn_ground_world_adoption_ready: ['select public.mn_ground_world_adoption_ready() as data', []],
          mn_load_ground_world_adoption: ['select public.mn_load_ground_world_adoption($1) as data', [args.p_world]],
          mn_adopt_ground_world: ['select public.mn_adopt_ground_world($1::uuid,$2::jsonb) as data',
            [args.p_operation_id, args.p_request]],
        };
        const statement = statements[name];
        if (!statement) throw new Error(`Unexpected adoption RPC: ${name}`);
        const data = (await db.query(statement[0], statement[1])).rows[0].data;
        return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
      } catch (error) {
        return new Response(JSON.stringify({ code: error.code ?? 'XX000', message: error.message ?? 'Local SQL rejection' }),
          { status: 400, headers: { 'content-type': 'application/json' } });
      }
    } },
  });
  return client;
}

export async function database(path) {
  const fixture = await databaseBeforeAdoption(path);
  try {
    await fixture.db.exec('RESET ROLE');
    const [sql022, sql023] = await Promise.all([migration022(), migration023()]);
    for (const sql of [sql022, sql023, sql022, sql023]) await fixture.db.exec(sql);
    await fixture.db.exec('SET ROLE service_role');
    return { ...fixture, adoptionClient: adoptionClient(fixture.db),
      async reapplyAdoptionMigration() {
        await fixture.db.exec('RESET ROLE');
        await fixture.db.exec(await migration023());
        await fixture.db.exec('SET ROLE service_role');
      },
      async seedWorld(world, { tick = 500, version = 1, seed = 91 } = {}) {
        const data = worldSnapshot(tick, seed);
        await fixture.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,$3)',
          [world, data, version]);
        return data;
      },
    };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}

export async function reopenDatabase(path) {
  const fixture = await reopenAdoptedDatabase(path);
  return { ...fixture, adoptionClient: adoptionClient(fixture.db),
    async reapplyAdoptionMigration() {
      await fixture.db.exec('RESET ROLE');
      await fixture.db.exec(await migration023());
      await fixture.db.exec('SET ROLE service_role');
    },
    async seedWorld(world, { tick = 500, version = 1, seed = 91 } = {}) {
      const data = worldSnapshot(tick, seed);
      await fixture.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,$3)',
        [world, data, version]);
      return data;
    },
  };
}
