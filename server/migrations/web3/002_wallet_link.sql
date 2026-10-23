BEGIN;

CREATE SCHEMA IF NOT EXISTS mn_web3_private;
REVOKE ALL ON SCHEMA mn_web3_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA mn_web3_private TO service_role;

CREATE TABLE IF NOT EXISTS mn_web3_private.wallet_challenges (
  challenge_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  address text NOT NULL,
  chain_id integer NOT NULL,
  nonce text NOT NULL UNIQUE,
  message text NOT NULL,
  issued_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'used')),
  result jsonb,
  CONSTRAINT mn_web3_wallet_challenge_nonzero CHECK (
    challenge_id <> '00000000-0000-0000-0000-000000000000'::uuid AND
    account_id <> '00000000-0000-0000-0000-000000000000'::uuid
  ),
  CONSTRAINT mn_web3_wallet_address CHECK (address ~ '^0x[0-9a-f]{40}$' AND address <> '0x0000000000000000000000000000000000000000'),
  CONSTRAINT mn_web3_wallet_chain CHECK (chain_id > 0),
  CONSTRAINT mn_web3_wallet_nonce CHECK (nonce ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mn_web3_wallet_message CHECK (pg_catalog.octet_length(message) BETWEEN 1 AND 2048),
  CONSTRAINT mn_web3_wallet_times CHECK (issued_at_ms > 0 AND expires_at_ms > issued_at_ms),
  CONSTRAINT mn_web3_wallet_terminal CHECK ((state = 'pending' AND result IS NULL) OR (state = 'used' AND result IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS mn_web3_wallet_challenges_account
  ON mn_web3_private.wallet_challenges (account_id, expires_at_ms DESC);
CREATE UNIQUE INDEX IF NOT EXISTS mn_web3_wallet_one_pending_account
  ON mn_web3_private.wallet_challenges (account_id) WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS mn_web3_private.wallet_links (
  account_id uuid PRIMARY KEY,
  address text NOT NULL,
  chain_id integer NOT NULL,
  challenge_id uuid NOT NULL UNIQUE REFERENCES mn_web3_private.wallet_challenges(challenge_id),
  CONSTRAINT mn_web3_wallet_link_nonzero CHECK (account_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT mn_web3_wallet_link_address CHECK (address ~ '^0x[0-9a-f]{40}$' AND address <> '0x0000000000000000000000000000000000000000'),
  CONSTRAINT mn_web3_wallet_link_chain CHECK (chain_id > 0),
  CONSTRAINT mn_web3_wallet_chain_address_unique UNIQUE (chain_id, address)
);

ALTER TABLE mn_web3_private.wallet_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE mn_web3_private.wallet_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mn_web3_service_select_wallet_challenges ON mn_web3_private.wallet_challenges;
CREATE POLICY mn_web3_service_select_wallet_challenges ON mn_web3_private.wallet_challenges
  FOR SELECT TO service_role USING (true);
DROP POLICY IF EXISTS mn_web3_service_select_wallet_links ON mn_web3_private.wallet_links;
CREATE POLICY mn_web3_service_select_wallet_links ON mn_web3_private.wallet_links
  FOR SELECT TO service_role USING (true);
REVOKE ALL ON TABLE mn_web3_private.wallet_challenges, mn_web3_private.wallet_links
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON mn_web3_private.wallet_challenges, mn_web3_private.wallet_links TO service_role;

CREATE OR REPLACE FUNCTION mn_web3_private.validate_wallet_request(p_request jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_challenge text;
  v_account text;
  v_address text;
  v_chain text;
  v_nonce text;
  v_message text;
  v_issued text;
  v_expires text;
  v_issued_ms bigint;
  v_expires_ms bigint;
  v_now_ms bigint;
BEGIN
  IF p_request IS NULL OR pg_catalog.jsonb_typeof(p_request) <> 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_request)) <> 8 OR
     NOT (p_request ?& ARRAY['challengeId','accountId','address','chainId','nonce','message','issuedAt','expiresAt']) THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW11', MESSAGE = 'input';
  END IF;
  IF pg_catalog.jsonb_typeof(p_request->'challengeId') <> 'string' OR
     pg_catalog.jsonb_typeof(p_request->'accountId') <> 'string' OR
     pg_catalog.jsonb_typeof(p_request->'address') <> 'string' OR
     pg_catalog.jsonb_typeof(p_request->'chainId') <> 'number' OR
     pg_catalog.jsonb_typeof(p_request->'nonce') <> 'string' OR
     pg_catalog.jsonb_typeof(p_request->'message') <> 'string' OR
     pg_catalog.jsonb_typeof(p_request->'issuedAt') <> 'number' OR
     pg_catalog.jsonb_typeof(p_request->'expiresAt') <> 'number' THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW11', MESSAGE = 'input';
  END IF;
  v_challenge := p_request->>'challengeId'; v_account := p_request->>'accountId';
  v_address := p_request->>'address'; v_chain := p_request->>'chainId';
  v_nonce := p_request->>'nonce'; v_message := p_request->>'message';
  v_issued := p_request->>'issuedAt'; v_expires := p_request->>'expiresAt';
  IF v_challenge !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
     v_challenge = '00000000-0000-0000-0000-000000000000' OR
     v_account !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
     v_account = '00000000-0000-0000-0000-000000000000' OR
     v_address !~ '^0x[0-9a-f]{40}$' OR v_address = '0x0000000000000000000000000000000000000000' OR
     v_nonce !~ '^[0-9a-f]{64}$' OR pg_catalog.octet_length(v_message) NOT BETWEEN 1 AND 2048 OR
     pg_catalog.encode(pg_catalog.convert_to(v_message, 'UTF8'), 'hex') !~ '^(0a|[2-6][0-9a-f]|7[0-9a-e])*$' OR
     v_chain::numeric < 1 OR v_chain::numeric <> pg_catalog.trunc(v_chain::numeric) OR
     v_chain::numeric > 2147483647 OR
     v_issued::numeric < 1 OR v_issued::numeric <> pg_catalog.trunc(v_issued::numeric) OR
     v_expires::numeric < 1 OR v_expires::numeric <> pg_catalog.trunc(v_expires::numeric) THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW11', MESSAGE = 'input';
  END IF;
  IF v_issued::numeric > 253402300799999 OR v_expires::numeric > 253402300799999 THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW11', MESSAGE = 'input';
  END IF;
  v_issued_ms := v_issued::numeric::bigint; v_expires_ms := v_expires::numeric::bigint;
  IF v_expires_ms - v_issued_ms NOT BETWEEN 30000 AND 600000 THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW11', MESSAGE = 'input';
  END IF;
  v_now_ms := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) * 1000)::bigint;
  IF v_issued_ms > v_now_ms + 10000 THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW11', MESSAGE = 'input';
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION mn_web3_private.wallet_challenge_json(p_row mn_web3_private.wallet_challenges)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'challengeId', p_row.challenge_id, 'accountId', p_row.account_id,
    'address', p_row.address, 'chainId', p_row.chain_id, 'nonce', p_row.nonce,
    'message', p_row.message, 'issuedAt', p_row.issued_at_ms, 'expiresAt', p_row.expires_at_ms
  )
$fn$;

CREATE OR REPLACE FUNCTION mn_web3_private.wallet_link_json(p_row mn_web3_private.wallet_links)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object('accountId', p_row.account_id, 'address', p_row.address,
    'chainId', p_row.chain_id, 'challengeId', p_row.challenge_id)
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_wallet_issue(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_challenge_id uuid;
  v_account_id uuid;
  v_address text;
  v_chain integer;
  v_nonce text;
  v_message text;
  v_issued bigint;
  v_expires bigint;
  v_now bigint;
  v_existing mn_web3_private.wallet_challenges%ROWTYPE;
  v_pending mn_web3_private.wallet_challenges%ROWTYPE;
  v_link mn_web3_private.wallet_links%ROWTYPE;
BEGIN
  PERFORM mn_web3_private.validate_wallet_request(p_request);
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW12', MESSAGE = 'isolation';
  END IF;
  v_challenge_id := (p_request->>'challengeId')::uuid;
  v_account_id := (p_request->>'accountId')::uuid;
  v_address := p_request->>'address'; v_chain := (p_request->>'chainId')::numeric::integer;
  v_nonce := p_request->>'nonce'; v_message := p_request->>'message';
  v_issued := (p_request->>'issuedAt')::numeric::bigint; v_expires := (p_request->>'expiresAt')::numeric::bigint;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:wallet-challenge:' || v_challenge_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:wallet-account:' || v_account_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:wallet-address:' || v_chain::text || ':' || v_address, 0));
  v_now := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) * 1000)::bigint;
  SELECT * INTO v_existing FROM mn_web3_private.wallet_challenges WHERE challenge_id = v_challenge_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.account_id <> v_account_id OR v_existing.address <> v_address OR v_existing.chain_id <> v_chain OR
       v_existing.nonce <> v_nonce OR v_existing.message <> v_message OR v_existing.issued_at_ms <> v_issued OR
       v_existing.expires_at_ms <> v_expires THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'identity');
    END IF;
    IF v_existing.state = 'used' THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'identity');
    END IF;
    IF v_existing.expires_at_ms <= v_now THEN
      UPDATE mn_web3_private.wallet_challenges SET state = 'used', result = '{"ok":false,"why":"expired"}'::jsonb
        WHERE challenge_id = v_challenge_id;
      RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'expired');
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', true,
      'challenge', mn_web3_private.wallet_challenge_json(v_existing));
  END IF;
  IF v_expires <= v_now THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'expired');
  END IF;
  SELECT * INTO v_link FROM mn_web3_private.wallet_links WHERE account_id = v_account_id;
  IF FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'linked'); END IF;
  SELECT * INTO v_pending FROM mn_web3_private.wallet_challenges
    WHERE account_id = v_account_id AND state = 'pending' AND challenge_id <> v_challenge_id
    ORDER BY challenge_id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_pending.expires_at_ms > v_now THEN
      IF v_pending.address = v_address AND v_pending.chain_id = v_chain THEN
        RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', true,
          'challenge', mn_web3_private.wallet_challenge_json(v_pending));
      END IF;
      RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'busy');
    END IF;
    UPDATE mn_web3_private.wallet_challenges SET state = 'used', result = '{"ok":false,"why":"expired"}'::jsonb
      WHERE challenge_id = v_pending.challenge_id;
  END IF;
  IF EXISTS (SELECT 1 FROM mn_web3_private.wallet_challenges WHERE nonce = v_nonce) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'identity');
  END IF;
  INSERT INTO mn_web3_private.wallet_challenges(challenge_id, account_id, address, chain_id, nonce, message, issued_at_ms, expires_at_ms)
  VALUES (v_challenge_id, v_account_id, v_address, v_chain, v_nonce, v_message, v_issued, v_expires)
  ON CONFLICT (nonce) DO NOTHING;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'identity'); END IF;
  SELECT * INTO v_existing FROM mn_web3_private.wallet_challenges WHERE challenge_id = v_challenge_id;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'replay', false,
    'challenge', mn_web3_private.wallet_challenge_json(v_existing));
END
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_wallet_complete(p_challenge_id uuid, p_account_id uuid, p_verified boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_challenge mn_web3_private.wallet_challenges%ROWTYPE;
  v_link mn_web3_private.wallet_links%ROWTYPE;
  v_result jsonb;
  v_now bigint;
BEGIN
  IF p_challenge_id IS NULL OR p_challenge_id = '00000000-0000-0000-0000-000000000000'::uuid OR
     p_account_id IS NULL OR p_account_id = '00000000-0000-0000-0000-000000000000'::uuid OR p_verified IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW11', MESSAGE = 'input';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW12', MESSAGE = 'isolation';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:wallet-challenge:' || p_challenge_id::text, 0));
  SELECT * INTO v_challenge FROM mn_web3_private.wallet_challenges WHERE challenge_id = p_challenge_id;
  IF NOT FOUND OR v_challenge.account_id <> p_account_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'missing');
  END IF;
  IF v_challenge.state = 'used' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'used'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:wallet-account:' || p_account_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mn-web3:wallet-address:' || v_challenge.chain_id::text || ':' || v_challenge.address, 0));
  SELECT * INTO v_challenge FROM mn_web3_private.wallet_challenges WHERE challenge_id = p_challenge_id FOR UPDATE;
  IF NOT FOUND OR v_challenge.account_id <> p_account_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'missing');
  END IF;
  IF v_challenge.state = 'used' THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'why', 'used'); END IF;
  v_now := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) * 1000)::bigint;
  IF v_challenge.expires_at_ms <= v_now THEN
    v_result := '{"ok":false,"why":"expired"}'::jsonb;
  ELSIF NOT p_verified THEN
    v_result := '{"ok":false,"why":"signature"}'::jsonb;
  ELSE
    SELECT * INTO v_link FROM mn_web3_private.wallet_links WHERE account_id = p_account_id;
    IF FOUND OR EXISTS (SELECT 1 FROM mn_web3_private.wallet_links WHERE chain_id = v_challenge.chain_id AND address = v_challenge.address) THEN
      v_result := '{"ok":false,"why":"conflict"}'::jsonb;
    ELSE
      INSERT INTO mn_web3_private.wallet_links(account_id, address, chain_id, challenge_id)
      VALUES (p_account_id, v_challenge.address, v_challenge.chain_id, p_challenge_id);
      SELECT * INTO v_link FROM mn_web3_private.wallet_links WHERE account_id = p_account_id;
      v_result := pg_catalog.jsonb_build_object('ok', true, 'link', mn_web3_private.wallet_link_json(v_link));
    END IF;
  END IF;
  UPDATE mn_web3_private.wallet_challenges SET state = 'used', result = v_result WHERE challenge_id = p_challenge_id;
  RETURN v_result;
END
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_wallet_challenge(p_challenge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_challenge mn_web3_private.wallet_challenges%ROWTYPE;
BEGIN
  IF p_challenge_id IS NULL OR p_challenge_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW11', MESSAGE = 'input';
  END IF;
  SELECT * INTO v_challenge FROM mn_web3_private.wallet_challenges WHERE challenge_id = p_challenge_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pg_catalog.jsonb_build_object('challenge', mn_web3_private.wallet_challenge_json(v_challenge),
    'state', v_challenge.state, 'result', v_challenge.result);
END
$fn$;

CREATE OR REPLACE FUNCTION public.mn_web3_wallet_link(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_link mn_web3_private.wallet_links%ROWTYPE;
BEGIN
  IF p_account_id IS NULL OR p_account_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'MNW11', MESSAGE = 'input';
  END IF;
  SELECT * INTO v_link FROM mn_web3_private.wallet_links WHERE account_id = p_account_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN mn_web3_private.wallet_link_json(v_link);
END
$fn$;

REVOKE ALL ON FUNCTION mn_web3_private.validate_wallet_request(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mn_web3_private.wallet_challenge_json(mn_web3_private.wallet_challenges) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION mn_web3_private.wallet_link_json(mn_web3_private.wallet_links) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mn_web3_wallet_issue(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mn_web3_wallet_complete(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mn_web3_wallet_challenge(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mn_web3_wallet_link(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mn_web3_wallet_issue(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_web3_wallet_complete(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_web3_wallet_challenge(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mn_web3_wallet_link(uuid) TO service_role;

COMMIT;
