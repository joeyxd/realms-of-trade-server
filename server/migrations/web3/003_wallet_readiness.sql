BEGIN;

CREATE OR REPLACE FUNCTION public.mn_web3_wallet_ready()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_service oid;
  v_anon oid;
  v_authenticated oid;
  v_table record;
  v_function record;
  v_oid oid;
  v_config text[];
BEGIN
  SELECT oid INTO v_service FROM pg_catalog.pg_roles WHERE rolname = 'service_role';
  SELECT oid INTO v_anon FROM pg_catalog.pg_roles WHERE rolname = 'anon';
  SELECT oid INTO v_authenticated FROM pg_catalog.pg_roles WHERE rolname = 'authenticated';
  IF v_service IS NULL OR v_anon IS NULL OR v_authenticated IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW13', MESSAGE = 'unavailable';
  END IF;

  FOR v_table IN
    SELECT c.oid, c.relname, c.relrowsecurity, c.relowner, c.relacl
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'mn_web3_private' AND c.relname IN ('wallet_challenges', 'wallet_links')
      AND c.relkind IN ('r', 'p')
  LOOP
    IF NOT v_table.relrowsecurity OR
       NOT pg_catalog.has_table_privilege(v_service, v_table.oid, 'SELECT') OR
       pg_catalog.has_table_privilege(v_service, v_table.oid, 'INSERT') OR
       pg_catalog.has_table_privilege(v_service, v_table.oid, 'UPDATE') OR
       pg_catalog.has_table_privilege(v_service, v_table.oid, 'DELETE') OR
       pg_catalog.has_table_privilege(v_service, v_table.oid, 'TRUNCATE') OR
       pg_catalog.has_table_privilege(v_service, v_table.oid, 'REFERENCES') OR
       pg_catalog.has_table_privilege(v_service, v_table.oid, 'TRIGGER') OR
       pg_catalog.has_any_column_privilege(v_service, v_table.oid, 'INSERT') OR
       pg_catalog.has_any_column_privilege(v_service, v_table.oid, 'UPDATE') OR
       pg_catalog.has_any_column_privilege(v_service, v_table.oid, 'REFERENCES') OR
       pg_catalog.has_table_privilege(v_anon, v_table.oid, 'SELECT') OR
       pg_catalog.has_table_privilege(v_anon, v_table.oid, 'INSERT') OR
       pg_catalog.has_table_privilege(v_anon, v_table.oid, 'UPDATE') OR
       pg_catalog.has_table_privilege(v_anon, v_table.oid, 'DELETE') OR
       pg_catalog.has_table_privilege(v_anon, v_table.oid, 'TRUNCATE') OR
       pg_catalog.has_table_privilege(v_anon, v_table.oid, 'REFERENCES') OR
       pg_catalog.has_table_privilege(v_anon, v_table.oid, 'TRIGGER') OR
       pg_catalog.has_any_column_privilege(v_anon, v_table.oid, 'SELECT') OR
       pg_catalog.has_any_column_privilege(v_anon, v_table.oid, 'INSERT') OR
       pg_catalog.has_any_column_privilege(v_anon, v_table.oid, 'UPDATE') OR
       pg_catalog.has_any_column_privilege(v_anon, v_table.oid, 'REFERENCES') OR
       pg_catalog.has_table_privilege(v_authenticated, v_table.oid, 'SELECT') OR
       pg_catalog.has_table_privilege(v_authenticated, v_table.oid, 'INSERT') OR
       pg_catalog.has_table_privilege(v_authenticated, v_table.oid, 'UPDATE') OR
       pg_catalog.has_table_privilege(v_authenticated, v_table.oid, 'DELETE') OR
       pg_catalog.has_table_privilege(v_authenticated, v_table.oid, 'TRUNCATE') OR
       pg_catalog.has_table_privilege(v_authenticated, v_table.oid, 'REFERENCES') OR
       pg_catalog.has_table_privilege(v_authenticated, v_table.oid, 'TRIGGER') OR
       pg_catalog.has_any_column_privilege(v_authenticated, v_table.oid, 'SELECT') OR
       pg_catalog.has_any_column_privilege(v_authenticated, v_table.oid, 'INSERT') OR
       pg_catalog.has_any_column_privilege(v_authenticated, v_table.oid, 'UPDATE') OR
       pg_catalog.has_any_column_privilege(v_authenticated, v_table.oid, 'REFERENCES') OR
       EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_table.relacl,
           pg_catalog.acldefault('r', v_table.relowner))) a
         WHERE a.grantee = 0 AND a.privilege_type IN
           ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW13', MESSAGE = 'unavailable';
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'mn_web3_private' AND c.relname IN ('wallet_challenges', 'wallet_links')
        AND c.relkind IN ('r', 'p')) <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW13', MESSAGE = 'unavailable';
  END IF;

  -- Parse the required row shape and verify the invoker can read it without fetching rows.
  PERFORM 1 FROM mn_web3_private.wallet_challenges
    WHERE challenge_id IS NULL AND account_id IS NULL AND address IS NULL AND chain_id IS NULL
      AND nonce IS NULL AND message IS NULL AND issued_at_ms IS NULL AND expires_at_ms IS NULL
      AND state IS NULL AND result IS NULL LIMIT 0;
  PERFORM 1 FROM mn_web3_private.wallet_links
    WHERE account_id IS NULL AND address IS NULL AND chain_id IS NULL AND challenge_id IS NULL LIMIT 0;

  FOR v_function IN
    SELECT x.signature, x.required
    FROM (VALUES
      ('public.mn_web3_wallet_issue(jsonb)', true),
      ('public.mn_web3_wallet_complete(uuid,uuid,boolean)', true),
      ('public.mn_web3_wallet_challenge(uuid)', true),
      ('public.mn_web3_wallet_link(uuid)', true),
      ('public.mn_web3_wallet_ready()', true),
      ('mn_web3_private.validate_wallet_request(jsonb)', false),
      ('mn_web3_private.wallet_challenge_json(mn_web3_private.wallet_challenges)', false),
      ('mn_web3_private.wallet_link_json(mn_web3_private.wallet_links)', false)
    ) x(signature, required)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_function.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'MNW13', MESSAGE = 'unavailable';
    END IF;
    SELECT p.proconfig INTO v_config FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_function.signature = 'public.mn_web3_wallet_ready()' THEN
      IF (SELECT p.prorettype FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) <> 'jsonb'::regtype OR
         (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) OR
         NOT ('search_path=""' = ANY(COALESCE(v_config, ARRAY[]::text[]))) OR
         NOT pg_catalog.has_function_privilege(v_service, v_oid, 'EXECUTE') OR
         pg_catalog.has_function_privilege(v_anon, v_oid, 'EXECUTE') OR
         pg_catalog.has_function_privilege(v_authenticated, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = 'MNW13', MESSAGE = 'unavailable';
      END IF;
    ELSIF v_function.required THEN
      IF (SELECT p.prorettype FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) <> 'jsonb'::regtype OR
         NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) OR
         NOT ('search_path=""' = ANY(COALESCE(v_config, ARRAY[]::text[]))) OR
         NOT pg_catalog.has_function_privilege(v_service, v_oid, 'EXECUTE') OR
         pg_catalog.has_function_privilege(v_anon, v_oid, 'EXECUTE') OR
         pg_catalog.has_function_privilege(v_authenticated, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = 'MNW13', MESSAGE = 'unavailable';
      END IF;
    ELSE
      IF pg_catalog.has_function_privilege(v_service, v_oid, 'EXECUTE') OR
         pg_catalog.has_function_privilege(v_anon, v_oid, 'EXECUTE') OR
         pg_catalog.has_function_privilege(v_authenticated, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = 'MNW13', MESSAGE = 'unavailable';
      END IF;
    END IF;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object('version', 1);
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = 'MNW13' THEN RAISE; END IF;
  RAISE EXCEPTION USING ERRCODE = 'MNW13', MESSAGE = 'unavailable';
END
$fn$;

REVOKE ALL ON FUNCTION public.mn_web3_wallet_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_web3_wallet_ready() TO service_role;

COMMIT;
