import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

CONTAINER = 'marea-negra-alpha-marea-negra-alpha-1'
COMPOSE_PROJECT = 'marea-negra-alpha'
RELEASE_ROOT = '/opt/marea-negra/releases'
RUNTIME_FILES = (
    'server/agentControl.mjs', 'server/host.mjs', 'server/index.mjs', 'server/store.mjs',
    'server/companionConfig.mjs', 'server/companionConfigStore.mjs', 'server/migrations/025_companion_config.sql',
    'server/companionControl.mjs', 'server/companionControlStore.mjs', 'server/migrations/027_companion_control.sql',
    'server/inferenceConfig.mjs', 'server/inferenceConfigStore.mjs', 'server/migrations/028_inference_config.sql',
    'src/net/protocol.js', 'src/net/companionConfig.js', 'src/net/inferenceConfig.js',
    'src/client/companions.js', 'src/client/companionConfig.js', 'src/client/inferenceConfig.js',
    'src/ui/companions.js', 'src/ui/companionConfig.js', 'src/ui/inferenceConfig.js',
    'src/main.js', 'src/client/gameClient.js',
    'src/editor/editor.js', 'src/editor/editor.css', 'src/editor/templatePanel.js',
    'src/editor/templateStore.js', 'src/editor/templates.js',
    'styles/hud.css', 'styles/minimap.css',
    'server/groundHostAuthority.mjs',
)


def fail(code):
    raise SystemExit(code)


def command(args, timeout=15):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode != 0:
        fail('deployment_snapshot_command_failed')
    return result.stdout.strip()


def inspect(template):
    return command(['docker', 'inspect', '--format=' + template, CONTAINER])


def authority_names():
    result = command(['docker', 'ps', '--filter', 'label=com.docker.compose.project=' + COMPOSE_PROJECT,
                      '--format', '{{.Names}}'])
    return [name for name in result.splitlines() if name]


def container_json(script, timeout=25):
    result = subprocess.run(['docker', 'exec', '-i', '-w', '/app', CONTAINER, 'node', '--input-type=module'],
                            input=script, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode != 0:
        fail('container_readonly_probe_failed')
    try:
        return json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        fail('container_readonly_probe_invalid')


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r'[0-9a-f]{40}', sys.argv[1]):
        fail('expected_revision_must_be_40_lowercase_hex')
    expected = sys.argv[1]
    revision = inspect('{{index .Config.Labels "org.opencontainers.image.revision"}}')
    version = inspect('{{index .Config.Labels "org.opencontainers.image.version"}}')
    compose_project = inspect('{{index .Config.Labels "com.docker.compose.project"}}')
    image_id = inspect('{{.Image}}')
    image = inspect('{{.Config.Image}}')
    container_id = inspect('{{.Id}}')
    running = inspect('{{.State.Running}}') == 'true'
    health = inspect('{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
    started_at = inspect('{{.State.StartedAt}}')
    oom_killed = inspect('{{.State.OOMKilled}}') == 'true'
    if revision != expected or not re.fullmatch(r'sha256:[0-9a-f]{64}', image_id or ''):
        fail('expected_revision_or_image_mismatch')
    if compose_project != COMPOSE_PROJECT or not running or health != 'healthy':
        fail('active_container_not_healthy')
    authorities = authority_names()
    if authorities != [CONTAINER]:
        fail('authority_count_not_one')

    validation_path = '/opt/marea-negra/ops/validated-' + revision + '.json'
    with open(validation_path, encoding='utf-8') as source:
        validation = json.load(source)
    if validation != {'revision': revision, 'image_id': image_id, 'tests_passed': True}:
        fail('image_validation_identity_mismatch')
    with open('/opt/marea-negra/ops/update-' + revision + '.log', encoding='utf-8') as source:
        log = source.read()
    count_names = ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo')
    counts = {}
    for key in count_names:
        found = re.findall(r'^# ' + re.escape(key) + r' (\d+)$', log, re.MULTILINE)
        if not found:
            fail('updater_test_counts_missing')
        counts[key] = int(found[-1])
    if counts['tests'] <= 0 or counts['pass'] != counts['tests'] or any(counts[k] for k in ('fail', 'cancelled', 'skipped')):
        fail('updater_tests_not_all_passing')

    hash_script = (
        'import { createHash } from "node:crypto"; import { readFileSync } from "node:fs"; '
        f'const files={json.dumps(RUNTIME_FILES)}; '
        'console.log(JSON.stringify(Object.fromEntries(files.map(file => [file, '
        'createHash("sha256").update(readFileSync("/app/"+file)).digest("hex")]))));'
    )
    hashes = container_json(hash_script)
    if set(hashes) != set(RUNTIME_FILES) or any(not isinstance(value, str) or
            not re.fullmatch(r'[0-9a-f]{64}', value) for value in hashes.values()):
        fail('runtime_source_hashes_invalid')

    readiness_script = """
import { storeFromEnv } from './server/store.mjs';
try {
  const store = storeFromEnv(process.env);
  const result = await store.checkInferenceConfig();
  const report = { durable: store.durable === true, version: result?.version ?? null };
  console.log(JSON.stringify(report));
  if (report.durable !== true || report.version !== 1) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ durable: false, version: null }));
  process.exitCode = 1;
}
"""
    readiness = container_json(readiness_script)
    if readiness != {'durable': True, 'version': 1}:
        fail('sql028_store_readiness_failed')

    timer_probe = subprocess.run(['systemctl', 'is-active', 'marea-negra-update.timer'],
                                 capture_output=True, text=True, check=False)
    print(json.dumps({
        'schema': 'mn.l03d.inference-config.deployment-snapshot.v1',
        'at': datetime.now(timezone.utc).isoformat(),
        'container': CONTAINER,
        'revision': revision,
        'version': version,
        'image': image,
        'imageId': image_id,
        'containerId': container_id,
        'running': running,
        'health': health,
        'startedAt': started_at,
        'oomKilled': oom_killed,
        'currentRelease': os.path.realpath('/opt/marea-negra/current'),
        'updateState': json.load(open('/opt/marea-negra/update-state.json', encoding='utf-8')),
        'validation': validation,
        'offlineCounts': counts,
        'sourceHashes': hashes,
        'readiness': {'schema': 'SQL028', **readiness},
        'authorities': authorities,
        'timer': timer_probe.stdout.strip(),
        'scope': 'SQL028 private owner/world connection-model configuration metadata only, with SQL025/SQL027 and gameplay regressions retained. No provider request, credential inspection, catalog provisioning, generation, spend ledger, or binding provisioning.',
        'limits': ['Readiness is queried through the internal store abstraction using the running container environment; credential values are neither collected nor emitted.',
                   'The snapshot identifies active image/source and updater test evidence; it does not prove authenticated public owner acceptance or provider/model availability.',
                   'Configured ceilings are saved metadata only; no shared spend reservation or generation is implemented by this cut.'],
    }, separators=(',', ':')))


if __name__ == '__main__':
    main()
