import json
import re
import subprocess
import sys


CONTAINER = 'marea-negra-alpha-marea-negra-alpha-1'
COMPOSE_PROJECT = 'marea-negra-alpha'
RELEASE_ROOT = '/opt/marea-negra/releases'
TESTS = (
    'companions-client.test.mjs',
    'companions-network.test.mjs',
    'companions-ui.test.mjs',
)
RUNTIME_FILES = (
    'server/agentControl.mjs',
    'server/host.mjs',
    'src/client/companions.js',
    'src/ui/companions.js',
    'src/main.js',
    'src/net/protocol.js',
)
COUNT_NAMES = ('tests', 'pass', 'fail', 'cancelled', 'skipped')


def output_error(code, expected=None, image_id=None, **extra):
    result = {'ok': False, 'expectedRevision': expected, 'imageId': image_id, 'error': code}
    result.update(extra)
    print(json.dumps(result, separators=(',', ':')))


def command(args, timeout=15):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode != 0:
        raise RuntimeError('docker_command_failed')
    return result.stdout.strip()


def inspect(template):
    return command(['docker', 'inspect', '--format=' + template, CONTAINER])


def authority_names():
    result = command([
        'docker', 'ps', '--filter', 'label=com.docker.compose.project=' + COMPOSE_PROJECT,
        '--format', '{{.Names}}',
    ])
    return [name for name in result.splitlines() if name]


def hashes_in_image(image_id, release):
    files = list(RUNTIME_FILES) + ['tests/' + name for name in TESTS]
    js = (
        "import { createHash } from 'node:crypto'; "
        "import { readFileSync } from 'node:fs'; "
        f"const files = {json.dumps(files)}; "
        "const hashes = Object.fromEntries(files.map((file) => [file, "
        "createHash('sha256').update(readFileSync('/app/' + file)).digest('hex')])); "
        "console.log(JSON.stringify(hashes));"
    )
    result = command([
        'docker', 'run', '--rm', '--network', 'none', '--cpus=1', '--memory=256m', '--entrypoint', 'node',
        '--volume', release + '/tests:/app/tests:ro', '--workdir=/app', image_id,
        '--input-type=module', '-e', js,
    ], timeout=30)
    return json.loads(result)


def test_image(image_id, release):
    return subprocess.run([
        'docker', 'run', '--rm', '--network', 'none', '--cpus=1', '--memory=256m',
        '--entrypoint', 'node', '--volume', release + '/tests:/app/tests:ro', '--workdir=/app',
        image_id, '--test', '--test-concurrency=1', '--test-reporter=tap',
        *('tests/' + name for name in TESTS),
    ], capture_output=True, text=True, timeout=120, check=False)


def parse_counts(tap):
    counts = {}
    for name in COUNT_NAMES:
        found = re.findall(r'^# ' + re.escape(name) + r' (\d+)$', tap, re.MULTILINE)
        if not found:
            raise ValueError('tap_counts_missing')
        counts[name] = int(found[-1])
    return counts


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r'[0-9a-f]{40}', sys.argv[1]):
        output_error('expected_revision_must_be_40_lowercase_hex')
        return 2

    expected = sys.argv[1]
    image_id = None
    try:
        revision = inspect('{{index .Config.Labels "org.opencontainers.image.revision"}}')
        image_id = inspect('{{.Image}}')
        running = inspect('{{.State.Running}}') == 'true'
        health = inspect('{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
        project = inspect('{{index .Config.Labels "com.docker.compose.project"}}')
        if revision != expected or not re.fullmatch(r'sha256:[0-9a-f]{64}', image_id or ''):
            output_error('active_revision_or_image_mismatch', expected, image_id)
            return 1
        if project != COMPOSE_PROJECT or not running or health != 'healthy':
            output_error('active_container_not_healthy_authority', expected, image_id,
                         running=running, health=health, composeProject=project)
            return 1

        before = authority_names()
        if before != [CONTAINER]:
            output_error('authority_count_before_tests_not_one', expected, image_id,
                         authorities=before)
            return 1

        release = RELEASE_ROOT + '/' + expected
        hashes = hashes_in_image(image_id, release)
        expected_hash_files = set(RUNTIME_FILES) | {'tests/' + name for name in TESTS}
        if set(hashes) != expected_hash_files or any(
                not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value)
                for value in hashes.values()):
            output_error('source_hashes_invalid', expected, image_id)
            return 1
        test = test_image(image_id, release)
        tap = test.stdout
        try:
            counts = parse_counts(tap)
        except ValueError:
            output_error('tap_counts_missing', expected, image_id, exitCode=test.returncode,
                         tap={'fixtureOnly': True, 'output': tap})
            return 1

        after = authority_names()
        ok = (test.returncode == 0 and counts['tests'] > 0
              and counts['pass'] == counts['tests'] and counts['fail'] == 0
              and counts['cancelled'] == 0 and counts['skipped'] == 0
              and after == [CONTAINER])
        result = {
            'ok': ok,
            'expectedRevision': expected,
            'imageId': image_id,
            'counts': counts,
            'tap': {'fixtureOnly': True, 'output': tap},
            'hashes': {
                'runtime': {name: hashes[name] for name in RUNTIME_FILES},
                'tests': {name: hashes['tests/' + name] for name in TESTS},
            },
            'authorityCountBefore': len(before),
            'authorityCountAfter': len(after),
            'authoritiesAfter': after,
            'runnerNetwork': 'none',
            'runnerLabels': [],
            'exitCode': test.returncode,
        }
        print(json.dumps(result, separators=(',', ':')))
        return 0 if ok else 1
    except subprocess.TimeoutExpired:
        output_error('command_timeout', expected, image_id, timeoutSeconds=120)
        return 1
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError):
        output_error('verification_failed', expected, image_id)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
