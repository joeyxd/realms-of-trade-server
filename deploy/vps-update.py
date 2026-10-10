#!/usr/bin/env python3
"""Safely build and replace the MAREA NEGRA VPS release when the world is idle."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

try:
    import fcntl
except ImportError:  # The module remains importable for isolated tests on Windows.
    fcntl = None

ROOT = Path("/opt/marea-negra")
OPS = ROOT / "ops"
SOURCE = ROOT / "source.git"
RELEASES = ROOT / "releases"
CURRENT = ROOT / "current"
LOCK = ROOT / "update.lock"
STATE = ROOT / "update-state.json"
REPO = "https://github.com/joeyxd/realms-of-trade-server.git"
BRANCH = "claude/loving-lovelace-ptbif7"
PROJECT = "marea-negra-alpha"
SERVICE = "marea-negra-alpha"
ENV_FILE = Path("/etc/marea-negra/alpha.env")
HOSTNAME = "marea.62.171.136.148.sslip.io"
WORLD_ID = "marea-negra"
ARCHIVE_PATHS = ("package.json", "package-lock.json", "index.html", "src", "server", "styles", "assets", ".dockerignore", "deploy", "tests")
TESTS = ("tests/store-host.test.mjs", "tests/accounts-server.test.mjs", "tests/world-state.test.mjs", "tests/world-host.test.mjs", "tests/raft-persistence.test.mjs", "tests/harvest-tools.test.mjs", "tests/server.test.mjs", "tests/deploy-runtime.test.mjs")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
COMMAND_TIMEOUT = 120
FETCH_TIMEOUT = 300
BLOB_BATCH_SIZE = 128
BUILD_TIMEOUT = 600
# Persistence fixtures scan many candidate landing positions on the one-CPU test container.
TEST_TIMEOUT = 600
COOLDOWN = 600


class UpdateError(RuntimeError):
    pass


class BusyWorld(UpdateError):
    pass


def run(args, *, timeout=COMMAND_TIMEOUT, cwd=None, env=None, input_text=None, check=True):
    """Run without a shell; caller controls output so secrets never reach stdout."""
    try:
        result = subprocess.run(args, cwd=cwd, env=env, input=input_text, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise UpdateError(f"command timed out after {timeout}s: {args[0]}") from exc
    if check and result.returncode:
        raise UpdateError(f"command failed ({result.returncode}): {args[0]}: {result.stdout[-2000:]}")
    return result


def git(args, *, timeout=COMMAND_TIMEOUT, check=True, input_text=None):
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    return run(["git", "-c", "credential.helper=", *args], timeout=timeout, env=env,
               input_text=input_text, check=check)


def valid_sha(value):
    return isinstance(value, str) and SHA_RE.fullmatch(value) is not None


def read_state():
    try:
        value = json.loads(STATE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(state):
    temp = STATE.with_suffix(".tmp")
    temp.write_text(json.dumps(state, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temp, 0o600)
    os.replace(temp, STATE)


def safe_env(release, sha):
    """Return only non-secret Compose interpolation values."""
    try:
        app_version = json.loads((release / "package.json").read_text(encoding="utf-8"))["version"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise UpdateError("release package.json has no valid version") from exc
    if not isinstance(app_version, str) or not re.fullmatch(r"[A-Za-z0-9.+_-]{1,80}", app_version):
        raise UpdateError("release package version is invalid")
    return write_compose_env(sha, f"marea-negra:alpha-{sha[:12]}", app_version)


def write_compose_env(sha, image, app_version):
    env_path = OPS / f"compose-{sha}.env"
    values = {
        "GAME_IMAGE": image,
        "GIT_COMMIT": sha,
        "APP_VERSION": app_version,
        "MN_ENV_FILE": str(ENV_FILE),
        "WORLD_ID": WORLD_ID,
        "GAME_HOSTNAME": HOSTNAME,
    }
    env_path.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")
    os.chmod(env_path, 0o600)
    return env_path, values


def compose(release, env_path, *args, timeout=COMMAND_TIMEOUT, check=True):
    return run(["docker", "compose", "--project-name", PROJECT, "--env-file", str(env_path),
                "-f", str(release / "deploy/compose.vps.yml"), *args], timeout=timeout, check=check)


def active_container():
    result = run(["docker", "ps", "--filter", f"label=com.docker.compose.project={PROJECT}",
                  "--filter", f"label=com.docker.compose.service={SERVICE}", "--format", "{{.ID}} {{.Names}}"])
    rows = [line.split(maxsplit=1) for line in result.stdout.splitlines() if line.strip()]
    if len(rows) > 1:
        raise UpdateError("multiple active project/service containers; refusing overlap")
    return rows[0][0] if rows else None


def local_status(container):
    # Use argv and stdin, never a shell; status contains no private env values.
    code = "fetch('http://127.0.0.1:5173/status').then(async r=>{const t=await r.text();process.stdout.write(t);if(!r.ok)process.exitCode=2}).catch(()=>process.exit(3))"
    result = run(["docker", "exec", "-i", container, "node", "-e", code], timeout=10, check=False)
    if result.returncode:
        raise UpdateError("active server status is unavailable")
    try:
        return json.loads(result.stdout)
    except ValueError as exc:
        raise UpdateError("active server returned invalid status") from exc


def operation_lanes_quiescent(storage):
    """Accept legacy status, but fail closed for any reported in-flight or unknown writer."""
    if "economic" in storage:
        economic = storage["economic"]
        if economic is not None and (not isinstance(economic, dict) or
                economic.get("enabled") is not True or type(economic.get("pending")) is not int or
                economic.get("pending") != 0 or
                economic.get("failed") is not False):
            return False
    if "profileWrites" in storage and (type(storage["profileWrites"]) is not int or
            storage["profileWrites"] != 0):
        return False
    if "worldWriting" in storage and storage["worldWriting"] is not False:
        return False
    return True


def is_idle_and_durable(status):
    if not isinstance(status, dict):
        return False
    storage = status.get("storage")
    world = storage.get("world") if isinstance(storage, dict) else None
    if not isinstance(storage, dict) or not isinstance(world, dict):
        return False
    if not operation_lanes_quiescent(storage):
        return False
    nullable = ("staging", "deathStaging", "deathDrops", "pearlGround", "combatDeaths", "startup")
    if not all(key in storage and storage[key] is None for key in nullable):
        return False
    if not (storage.get("durable") is True and storage.get("accounts") is True and
            storage.get("unsaved") == 0 and storage.get("errors") == 0 and
            storage.get("tickBlocked") is False and status.get("errors") == 0 and
            status.get("players") == 0 and status.get("sockets") == 0 and
            world.get("id") == WORLD_ID and world.get("ready") is True and world.get("failed") is False):
        return False
    coord = world.get("coord", status.get("coord"))
    return coord is None


def runtime_status_ready(status):
    if not isinstance(status, dict):
        return False
    storage = status.get("storage")
    world = storage.get("world") if isinstance(storage, dict) else None
    return bool(isinstance(storage, dict) and isinstance(world, dict) and
                operation_lanes_quiescent(storage) and
                storage.get("durable") is True and storage.get("accounts") is True and
                storage.get("unsaved") == 0 and storage.get("errors") == 0 and storage.get("tickBlocked") is False and
                status.get("errors") == 0 and world.get("id") == WORLD_ID and
                world.get("ready") is True and world.get("failed") is False)


def wait_public_health(timeout=5):
    request = urllib.request.Request(f"https://{HOSTNAME}/health", method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError):
        return False


def runtime_ready(container, deadline):
    while time.monotonic() < deadline:
        try:
            status = local_status(container)
            health = run(["docker", "exec", container, "node", "-e",
                          "fetch('http://127.0.0.1:5173/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(2))"], timeout=8, check=False)
            if health.returncode == 0 and runtime_status_ready(status) and wait_public_health():
                return True
        except UpdateError:
            pass
        time.sleep(3)
    return False


def dockerfile_guard(release):
    dockerfile = release / "deploy/Dockerfile"
    runtime = release / "deploy/runtime.mjs"
    if not dockerfile.is_file() or not runtime.is_file():
        raise UpdateError("release is missing Dockerfile or runtime guard")
    if "deploy/runtime.mjs" not in dockerfile.read_text(encoding="utf-8"):
        raise UpdateError("Dockerfile does not include the runtime guard")


def archive_release(sha):
    if not valid_sha(sha):
        raise UpdateError("refusing invalid commit SHA")
    release = RELEASES / sha
    if release.exists():
        dockerfile_guard(release)
        return release
    RELEASES.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{sha}.", dir=RELEASES))
    try:
        prefetch_release_blobs(sha)
        result = subprocess.run(["git", "-c", "credential.helper=", "--git-dir", str(SOURCE), "archive", "--format=tar", sha, *ARCHIVE_PATHS],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=COMMAND_TIMEOUT, check=False)
        if result.returncode:
            raise UpdateError("git archive failed")
        import io, tarfile
        with tarfile.open(fileobj=io.BytesIO(result.stdout), mode="r:") as tar:
            tar.extractall(staging, filter="data")
        dockerfile_guard(staging)
        for base, dirs, files in os.walk(staging):
            for name in dirs:
                os.chmod(Path(base) / name, 0o555)
            for name in files:
                os.chmod(Path(base) / name, 0o444)
        os.chmod(staging, 0o555)
        os.rename(staging, release)
        return release
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def ensure_source():
    if not SOURCE.exists():
        git(["init", "--bare", str(SOURCE)])
        git(["--git-dir", str(SOURCE), "remote", "add", "origin", REPO])
    else:
        git(["--git-dir", str(SOURCE), "remote", "set-url", "origin", REPO])
    git(["--git-dir", str(SOURCE), "config", "remote.origin.promisor", "true"])
    git(["--git-dir", str(SOURCE), "config", "remote.origin.partialclonefilter", "blob:none"])
    git(["--git-dir", str(SOURCE), "fetch", "--filter=blob:none", "--depth=8", "--no-tags", "origin",
         f"refs/heads/{BRANCH}:refs/remotes/origin/{BRANCH}"], timeout=FETCH_TIMEOUT)


def prefetch_release_blobs(sha):
    listing = git(["--git-dir", str(SOURCE), "ls-tree", "-r", sha, "--", *ARCHIVE_PATHS])
    blobs = set()
    for line in listing.stdout.splitlines():
        try:
            metadata, _path = line.split("\t", 1)
            _mode, kind, object_id = metadata.split()
        except ValueError as exc:
            raise UpdateError("Git returned a malformed selected-path tree entry") from exc
        if kind != "blob":
            continue
        if not valid_sha(object_id):
            raise UpdateError("Git returned a malformed selected-path blob ID")
        blobs.add(object_id)
    ordered = sorted(blobs)
    for start in range(0, len(ordered), BLOB_BATCH_SIZE):
        batch = ordered[start:start + BLOB_BATCH_SIZE]
        # Explicit blob wants have no commit ancestry to negotiate (notably on Git 2.43).
        git(["-c", "fetch.negotiationAlgorithm=noop", "--git-dir", str(SOURCE), "fetch", "origin",
             "--no-tags", "--no-write-fetch-head", "--recurse-submodules=no", "--filter=blob:none", "--stdin"],
            timeout=FETCH_TIMEOUT, input_text="\n".join(batch) + "\n")


def remote_sha():
    result = git(["--git-dir", str(SOURCE), "rev-parse", f"refs/remotes/origin/{BRANCH}"])
    sha = result.stdout.strip()
    if not valid_sha(sha):
        raise UpdateError("remote returned invalid commit SHA")
    return sha


def active_metadata(container):
    if container is None:
        return None, None, None
    result = run(["docker", "inspect", "--format",
                  "{{.Config.Image}} {{.Image}} {{ index .Config.Labels \"org.opencontainers.image.revision\" }}", container])
    try:
        image, image_id, sha = result.stdout.strip().split()
    except ValueError as exc:
        raise UpdateError("active container image metadata is invalid") from exc
    if not valid_sha(sha) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise UpdateError("active container revision or image ID is invalid")
    image_match = re.fullmatch(r"marea-negra:alpha-([0-9a-f]{7,40})", image)
    if not image_match or not sha.startswith(image_match.group(1)):
        raise UpdateError("active container image tag does not match its revision")
    image_revision = run(["docker", "image", "inspect", "--format",
                          "{{ index .Config.Labels \"org.opencontainers.image.revision\" }}", image_id]).stdout.strip()
    if image_revision != sha:
        raise UpdateError("active image label does not match its container")
    tagged_id, tagged_revision = image_metadata(image)
    if tagged_id != image_id or tagged_revision != sha:
        raise UpdateError("active image tag no longer resolves to its running image")
    return sha, image, image_id


def active_revision(container):
    return active_metadata(container)[0]


def reject_rewind(candidate, active):
    if active is None:
        return
    for deepen_count in range(5):
        result = git(["--git-dir", str(SOURCE), "merge-base", "--is-ancestor", active, candidate], check=False)
        if result.returncode == 0:
            return
        if result.returncode != 1:
            raise UpdateError("Git could not verify active revision ancestry")
        shallow = git(["--git-dir", str(SOURCE), "rev-parse", "--is-shallow-repository"], check=False)
        if shallow.returncode != 0:
            raise UpdateError("Git could not inspect source repository depth")
        if shallow.stdout.strip() != "true":
            raise UpdateError("remote branch rewinds or diverges from active revision")
        if deepen_count == 4:
            break
        git(["--git-dir", str(SOURCE), "fetch", "--filter=blob:none", "--deepen=32", "--no-tags", "origin",
             f"refs/heads/{BRANCH}:refs/remotes/origin/{BRANCH}"], timeout=FETCH_TIMEOUT)
    raise UpdateError("active revision ancestry remains unknown after bounded shallow fetches")


def prior_release(active):
    try:
        release = CURRENT.resolve(strict=True)
    except OSError as exc:
        raise UpdateError("current release pointer is missing or invalid") from exc
    if (not release.is_relative_to(RELEASES) or not valid_sha(release.name) or
            release.name != active or not release.is_dir()):
        raise UpdateError("current release pointer does not match the active container")
    if not (release / "deploy/compose.vps.yml").is_file():
        raise UpdateError("current release has no rollback Compose file")
    return release


def cpu_counters():
    try:
        with open("/proc/stat", encoding="ascii") as stream:
            line = next(line for line in stream if line.startswith("cpu "))
        values = [int(value) for value in line.split()[1:]]
    except (OSError, ValueError, StopIteration):
        raise BusyWorld("CPU counters are unavailable; update deferred")
    if len(values) < 8 or any(value < 0 for value in values):
        raise BusyWorld("CPU counters are invalid; update deferred")
    return values[:8]


def cpu_pressure():
    before = cpu_counters()
    time.sleep(0.25)
    after = cpu_counters()
    delta = [end - start for start, end in zip(before, after)]
    if any(value < 0 for value in delta):
        raise BusyWorld("CPU counters changed unexpectedly; update deferred")
    total = sum(delta)
    idle, iowait = delta[3], delta[4]
    if total <= 0 or idle + iowait > total:
        raise BusyWorld("CPU counter interval is invalid; update deferred")
    return (total - idle - iowait) / total, iowait / total


def resource_gate():
    try:
        busy, iowait = cpu_pressure()
        with open("/proc/meminfo", encoding="ascii") as stream:
            mem_available = next(int(line.split()[1]) for line in stream if line.startswith("MemAvailable:"))
        free_disk = shutil.disk_usage(RELEASES).free
    except (OSError, ValueError, StopIteration):
        raise BusyWorld("host resource state is unavailable; update deferred")
    if busy >= 0.90 or iowait >= 0.30:
        raise BusyWorld("host CPU busy or I/O wait is above update threshold")
    if mem_available < 2 * 1024 * 1024 or free_disk < 5 * 1024**3:
        raise BusyWorld("host available memory or free disk is below update threshold")


def image_metadata(image):
    output = run(["docker", "image", "inspect", "--format",
                  "{{.Id}} {{ index .Config.Labels \"org.opencontainers.image.revision\" }}", image]).stdout.strip()
    parts = output.split()
    if len(parts) != 2 or not re.fullmatch(r"sha256:[0-9a-f]{64}", parts[0]) or parts[1] == "<no value>":
        raise UpdateError("built image metadata is invalid")
    return parts[0], parts[1]


def prepare_image(release, env_path, env_values, sha, log_path):
    logs = []
    try:
        cfg = compose(release, env_path, "config", "--quiet")
        logs.append(cfg.stdout)
        marker = OPS / f"validated-{sha}.json"
        try:
            image_id, image_revision = image_metadata(env_values["GAME_IMAGE"])
        except UpdateError:
            image_id, image_revision = None, None
        try:
            cached = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            cached = {}
        if image_id is not None and image_revision == sha and cached == {"revision": sha, "image_id": image_id, "tests_passed": True}:
            return
        resource_gate()
        build = compose(release, env_path, "build", "--memory", "1g", SERVICE, timeout=BUILD_TIMEOUT)
        logs.append(build.stdout)
        image_id, image_revision = image_metadata(env_values["GAME_IMAGE"])
        if image_revision != sha:
            raise UpdateError("built image label does not match requested release")
        test_name = f"marea-update-test-{sha[:12]}-{uuid.uuid4().hex[:12]}"
        test_args = ["docker", "run", "--name", test_name, "--network", "none", "--cpus", "1", "--memory", "1g",
                     "--volume", f"{release / 'tests'}:/app/tests:ro", "--workdir", "/app",
                     env_values["GAME_IMAGE"], "node", "--test", "--test-concurrency=1", *TESTS]
        try:
            tests = run(test_args, timeout=TEST_TIMEOUT, check=False)
            logs.append(tests.stdout[-500000:])
            if tests.returncode:
                raise UpdateError("offline release tests failed")
        finally:
            run(["docker", "rm", "-f", test_name], timeout=20, check=False)
        marker.write_text(json.dumps({"revision": sha, "image_id": image_id, "tests_passed": True}) + "\n", encoding="utf-8")
        os.chmod(marker, 0o600)
    except Exception as exc:
        logs.append(f"\nFAILED: {type(exc).__name__}: {str(exc)[:4000]}\n")
        raise
    finally:
        with log_path.open("a", encoding="utf-8") as stream:
            stream.write("".join(logs)[-1000000:])


def check_only():
    result = git(["ls-remote", "--exit-code", "--heads", REPO, f"refs/heads/{BRANCH}"])
    rows = result.stdout.split()
    remote = rows[0] if len(rows) == 2 and rows[1] == f"refs/heads/{BRANCH}" else None
    if not valid_sha(remote):
        raise UpdateError("public branch lookup returned no valid SHA")
    current = active_container()
    active = active_revision(current)
    print(json.dumps({"remote_revision": remote, "current_revision": active}, sort_keys=True))


def deploy(candidate):
    if not valid_sha(candidate):
        raise UpdateError("refusing invalid commit SHA")
    container = active_container()
    active, old_image, old_image_id = active_metadata(container)
    if active == candidate:
        print(f"already current: {candidate}")
        return
    reject_rewind(candidate, active)
    previous = prior_release(active) if container else None
    state = read_state()
    if state.get("failed_sha") == candidate and time.time() - float(state.get("failed_at", 0)) < COOLDOWN:
        raise UpdateError("candidate is in failure cooldown")
    if container is None:
        raise UpdateError("no existing active container; refusing first-time deployment")
    if not is_idle_and_durable(local_status(container)):
        raise BusyWorld("world is busy or durable status is not ready; deployment deferred")
    release = archive_release(candidate)
    env_path, env_values = safe_env(release, candidate)
    log_path = OPS / f"update-{candidate}.log"
    OPS.mkdir(parents=True, exist_ok=True)
    try:
        prepare_image(release, env_path, env_values, candidate, log_path)
        status = local_status(container)
        if not is_idle_and_durable(status):
            raise BusyWorld("world is busy or durable status is not ready; deployment deferred")
        if active_container() != container or active_revision(container) != active:
            raise UpdateError("active container changed before switch")
        try:
            compose(release, env_path, "stop", "-t", "90", SERVICE)
            deadline_stop = time.monotonic() + 95
            while time.monotonic() < deadline_stop and active_container() == container:
                time.sleep(1)
            if active_container() is not None:
                raise UpdateError("a project service container is still running; refusing overlap")
            compose(release, env_path, "up", "-d", "--no-build", "--scale", f"{SERVICE}=1", SERVICE)
            new_container = active_container()
            if new_container is None or new_container == container:
                raise UpdateError("new container did not start")
            if active_revision(new_container) != candidate:
                raise UpdateError("new container revision does not match requested release")
            if runtime_ready(new_container, time.monotonic() + 90):
                new_container = None
            else:
                raise UpdateError("new release failed health verification")
        except Exception as switch_error:
            running = active_container()
            if running == container:
                raise
            if running is not None:
                compose(release, env_path, "stop", "-t", "90", SERVICE, check=False)
                if active_container() is not None:
                    raise UpdateError("failed container did not stop; rollback withheld to prevent overlap") from switch_error
            old_release = previous
            old_version = json.loads((old_release / "package.json").read_text(encoding="utf-8"))["version"]
            tagged_id, tagged_revision = image_metadata(old_image)
            if tagged_id != old_image_id or tagged_revision != active:
                raise UpdateError("prior image tag changed; rollback withheld")
            old_env_path, _ = write_compose_env(active, old_image, old_version)
            compose(old_release, old_env_path, "config", "--quiet")
            compose(old_release, old_env_path, "up", "-d", "--no-build", "--scale", f"{SERVICE}=1", SERVICE)
            rollback_container = active_container()
            if rollback_container is None or active_revision(rollback_container) != active:
                raise UpdateError("new release failed and prior revision could not be restored") from switch_error
            if not runtime_ready(rollback_container, time.monotonic() + 90):
                raise UpdateError("prior revision restarted but failed health verification") from switch_error
            raise UpdateError(f"{switch_error}; prior release restored") from switch_error
        current_tmp = ROOT / f".current-{candidate[:12]}"
        current_tmp.unlink(missing_ok=True)
        current_tmp.symlink_to(release)
        os.replace(current_tmp, CURRENT)
        state.pop("failed_sha", None)
        state.pop("failed_at", None)
        write_state(state)
        print(f"updated {candidate}")
    except BusyWorld as exc:
        with log_path.open("a", encoding="utf-8") as stream:
            stream.write(f"\nDEFERRED: {exc}\n")
        raise
    except Exception as exc:
        with log_path.open("a", encoding="utf-8") as stream:
            stream.write(f"\nFAILED: {type(exc).__name__}: {str(exc)[:4000]}\n")
        state["failed_sha"] = candidate
        state["failed_at"] = time.time()
        write_state(state)
        raise


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if fcntl is None or not hasattr(os, "geteuid"):
        print("vps-update requires Linux", file=sys.stderr)
        return 2
    if os.geteuid() != 0:
        print("vps-update must run as root", file=sys.stderr)
        return 2
    if argv == ["--check"]:
        try:
            check_only()
            return 0
        except UpdateError as exc:
            print(f"check failed: {exc}", file=sys.stderr)
            return 1
    OPS.mkdir(parents=True, exist_ok=True)
    RELEASES.mkdir(parents=True, exist_ok=True)
    try:
        with LOCK.open("a+") as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print("another update is running", file=sys.stderr)
                return 0
            if argv:
                raise UpdateError("usage: vps-update.py [--check]")
            ensure_source()
            candidate = remote_sha()
            try:
                deploy(candidate)
            except BusyWorld:
                print("world busy; update deferred")
            return 0
    except UpdateError as exc:
        print(f"update failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
