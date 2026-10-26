// Real SDK over local PostgreSQL. Only fixture tables/RPCs used by canaries are exposed.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const routes = {
  mn_initialize_profile: ['mn_initialize_profile($1::uuid,$2::jsonb,$3)', ['p_player_id','p_data','p_legacy_key']],
  mn_load_profile: ['mn_load_profile($1::uuid)', ['p_player_id']],
  mn_save_profile: ['mn_save_profile($1::uuid,$2::jsonb,$3::integer)', ['p_player_id','p_data','p_expected_version']],
  mn_load_unique: ['mn_load_unique($1)', ['p_uid']],
  mn_commit_pearl: ['mn_commit_pearl($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_commit_pearl_ground: ['mn_commit_pearl_ground($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_load_pearl_location: ['mn_load_pearl_location($1)', ['p_uid']],
  mn_list_pearl_ground: ['mn_list_pearl_ground($1,$2,$3::integer)', ['p_world','p_after_uid','p_limit']],
  mn_load_pearl_ground_operation: ['mn_load_pearl_ground_operation($1::uuid)', ['p_operation_id']],
  mn_commit_pearl_batch: ['mn_commit_pearl_batch($1::uuid,$2::jsonb)', ['p_operation_id','p_request']],
  mn_load_pearl_batch_operation: ['mn_load_pearl_batch_operation($1::uuid)', ['p_operation_id']],
  mn_valid_pearl_intent: ['mn_valid_pearl_intent($1,$2,$3::jsonb)', ['p_scope','p_family','p_request']],
  mn_prepare_pearl_intent: ['mn_prepare_pearl_intent($1,$2,$3::uuid,$4::jsonb)', ['p_scope','p_family','p_operation_id','p_request']],
  mn_resolve_pearl_intent: ['mn_resolve_pearl_intent($1,$2,$3::uuid,$4::jsonb,$5)', ['p_scope','p_family','p_operation_id','p_request','p_state']],
  mn_list_pearl_intents: ['mn_list_pearl_intents($1,$2::uuid,$3::integer)', ['p_scope','p_after_id','p_limit']],
};
const tables = { mn_profiles:'player_id', mn_unique_items:'uid', mn_pearl_locations:'uid',
  mn_pearl_operations:'operation_id', mn_pearl_ground_operations:'operation_id',
  mn_pearl_batch_operations:'operation_id', mn_pearl_intents:'operation_id' };
export function canaryClient(db, publicRole = false, calls = []) {
  const fetch = async (input, init = {}) => {
    const url = new URL(input), name = url.pathname.split('/').at(-1), body = JSON.parse(init.body ?? '{}');
    calls.push({ name, method:init.method, body:structuredClone(body), url:String(url) });
    const response = (data,status=200) => new Response(JSON.stringify(data), { status, headers:{'content-type':'application/json'} });
    try {
      if (publicRole) await db.exec('RESET ROLE; SET ROLE anon');
      if (url.pathname.includes('/rpc/')) {
        const [sql,keys] = routes[name];
        return response((await db.query(`select public.${sql} as data`, keys.map((k)=>body[k]))).rows[0].data);
      }
      const key=tables[name]; assert.ok(key);
      const filter=url.searchParams.get(key); assert.ok(filter);
      const values=filter.startsWith('in.(')?filter.slice(4,-1).split(',').map((s)=>s.replace(/^"|"$/g,'')):[filter.slice(3)];
      const cast=key==='uid'?'text':'uuid';
      if (init.method==='DELETE') {
        const args=[],clauses=[];
        for(const [column,value] of url.searchParams) {
          assert.match(column,/^[a-z_]+$/);
          if(value==='is.null'){clauses.push(`${column} IS NULL`);continue;}
          assert.ok(value.startsWith('eq.'));
          const columnCast=['request','result','data','ground'].includes(column)?'jsonb':
            ['player_id','operation_id','holder'].includes(column)?'uuid':column==='version'?'integer':column==='since'?'timestamptz':'text';
          args.push(value.slice(3));clauses.push(`${column}=$${args.length}::${columnCast}`);
        }
        await db.query(`delete from public.${name} where ${clauses.join(' AND ')}`,args);return response(null);
      }
      const columns=url.searchParams.get('select');assert.match(columns,/^[a-z_,]+$/);
      const rows=(await db.query(`select ${columns} from public.${name} where ${key}=ANY($1::${cast}[]) order by ${key}`,[values])).rows;
      const single=new Headers(init.headers).get('accept')?.includes('object+json');
      return response(single?rows[0]??null:rows);
    } catch(err){return response({message:'Local SQL rejection',code:err.code??'XX000'},400);}
    finally{if(publicRole)await db.exec('RESET ROLE; SET ROLE service_role');}
  };
  return createClient('http://supabase.test','canary-test-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch},
  });
}
