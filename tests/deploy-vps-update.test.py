import importlib.util
import os
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "deploy" / "vps-update.py"
SPEC = importlib.util.spec_from_file_location("vps_update", SCRIPT)
update = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(update)


class VpsUpdateTests(unittest.TestCase):
    def test_missing_container_has_no_image_metadata(self):
        self.assertEqual(update.active_metadata(None), (None, None, None))

    @staticmethod
    def idle_status():
        return {
            "errors": 0, "players": 0, "sockets": 0,
            "storage": {
                "durable": True, "accounts": True, "errors": 0, "unsaved": 0,
                "tickBlocked": False,
                "staging": None, "deathStaging": None, "deathDrops": None,
                "pearlGround": None, "combatDeaths": None, "startup": None,
                "world": {"id": "marea-negra", "ready": True, "failed": False},
            },
        }

    def test_rejects_non_full_or_non_hex_revision(self):
        for value in ("", "deadbeef", "g" * 40, "0" * 39, "0" * 40 + "0", None):
            with self.subTest(value=value):
                self.assertFalse(update.valid_sha(value))
        self.assertTrue(update.valid_sha("a" * 40))

    def test_refuses_multiple_running_project_service_containers(self):
        result = mock.Mock(stdout="one marea-negra-alpha-1\ntwo marea-negra-alpha-2\n")
        with mock.patch.object(update, "run", return_value=result):
            with self.assertRaisesRegex(update.UpdateError, "multiple active"):
                update.active_container()

    def test_active_image_tag_and_image_id_must_match_revision(self):
        sha = "d" * 40
        image_id = "sha256:" + "3" * 64
        outputs = [
            mock.Mock(stdout=f"marea-negra:alpha-{sha[:12]} {image_id} {sha}"),
            mock.Mock(stdout=sha),
            mock.Mock(stdout=f"{image_id} {sha}"),
        ]
        with mock.patch.object(update, "run", side_effect=outputs):
            self.assertEqual(update.active_metadata("container"), (sha, f"marea-negra:alpha-{sha[:12]}", image_id))

        outputs = [
            mock.Mock(stdout=f"marea-negra:alpha-{sha[:12]} {image_id} {sha}"),
            mock.Mock(stdout=sha),
            mock.Mock(stdout=f"sha256:{'4' * 64} {sha}"),
        ]
        with mock.patch.object(update, "run", side_effect=outputs):
            with self.assertRaisesRegex(update.UpdateError, "tag no longer resolves"):
                update.active_metadata("container")

    def test_busy_world_is_deferred_before_compose_stop(self):
        release = Path("/release")
        sha = "a" * 40
        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(update, "active_container", return_value="old"))
            stack.enter_context(mock.patch.object(update, "active_metadata", return_value=("b" * 40, "marea-negra:alpha-bbbbbbb", "sha256:" + "1" * 64)))
            stack.enter_context(mock.patch.object(update, "reject_rewind"))
            stack.enter_context(mock.patch.object(update, "prior_release", return_value=release))
            stack.enter_context(mock.patch.object(update, "read_state", return_value={}))
            archive = stack.enter_context(mock.patch.object(update, "archive_release", return_value=release))
            status = stack.enter_context(mock.patch.object(update, "local_status", return_value={"players": 1}))
            compose = stack.enter_context(mock.patch.object(update, "compose"))
            with self.assertRaises(update.BusyWorld):
                update.deploy(sha)
        self.assertEqual(status.call_count, 1)
        archive.assert_not_called()
        compose.assert_not_called()

    def test_idle_fence_requires_full_status_and_new_readiness_allows_players(self):
        status = self.idle_status()
        self.assertTrue(update.is_idle_and_durable(status))
        self.assertTrue(update.runtime_status_ready(status))
        joined = self.idle_status()
        joined["players"] = 1
        joined["sockets"] = 1
        self.assertFalse(update.is_idle_and_durable(joined))
        self.assertTrue(update.runtime_status_ready(joined))
        for field in ("staging", "deathStaging", "deathDrops", "pearlGround", "combatDeaths", "startup"):
            invalid = self.idle_status()
            del invalid["storage"][field]
            self.assertFalse(update.is_idle_and_durable(invalid), field)
        failed = self.idle_status()
        failed["storage"]["world"]["failed"] = True
        self.assertFalse(update.is_idle_and_durable(failed))

    def test_legacy_current_release_can_rollback_without_runtime_guard(self):
        with tempfile.TemporaryDirectory() as temp:
            releases = Path(temp) / "releases"
            old = releases / ("b" * 40)
            (old / "deploy").mkdir(parents=True)
            (old / "deploy" / "compose.vps.yml").write_text("services: {}\n")
            current = mock.Mock()
            current.resolve.return_value = old
            with mock.patch.object(update, "RELEASES", releases), mock.patch.object(update, "CURRENT", current):
                self.assertEqual(update.prior_release("b" * 40), old)

    def test_first_candidate_builds_before_testing_when_tag_is_absent(self):
        sha = "c" * 40
        image_id = "sha256:" + "2" * 64
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            release = root / "release"
            (release / "tests").mkdir(parents=True)
            log = root / "update.log"
            with mock.patch.object(update, "OPS", root), \
                 mock.patch.object(update, "compose", return_value=mock.Mock(stdout="")) as compose, \
                 mock.patch.object(update, "image_metadata", side_effect=[update.UpdateError("image missing"), (image_id, sha)]), \
                 mock.patch.object(update, "resource_gate") as gate, \
                 mock.patch.object(update, "run", side_effect=[mock.Mock(stdout="tests passed", returncode=0), mock.Mock(stdout="", returncode=0)]) as run:
                update.prepare_image(release, root / "compose.env", {"GAME_IMAGE": "marea-negra:alpha-cccccccccccc"}, sha, log)

            self.assertTrue(any(call.args[2:4] == ("build", "--memory") for call in compose.call_args_list))
            self.assertEqual(gate.call_count, 1)
            self.assertTrue((root / f"validated-{sha}.json").is_file())
            test_command = run.call_args_list[0].args[0]
            self.assertIn("--network", test_command)
            self.assertIn("none", test_command)
            self.assertNotIn("--rm", test_command)
            self.assertEqual(run.call_args_list[1].args[0][:4], ["docker", "rm", "-f", test_command[test_command.index("--name") + 1]])

    def test_failed_candidate_stops_before_prior_release_rollback(self):
        sha, old_sha = "a" * 40, "b" * 40
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            old_release = base / old_sha
            old_release.mkdir()
            (old_release / "package.json").write_text('{"version":"old"}')
            current = mock.Mock()
            current.resolve.return_value = old_release
            env_file = base / "env"
            events = []

            def compose(release, env_path, *args, **kwargs):
                events.append((release.resolve(), args))
                return mock.Mock(stdout="")

            active_ids = iter(["old-container", "old-container", None, None, "new-container", "new-container", None, "rollback-container"])
            def active():
                return next(active_ids)

            with ExitStack() as stack:
                stack.enter_context(mock.patch.object(update, "active_container", side_effect=active))
                stack.enter_context(mock.patch.object(update, "active_metadata", return_value=(old_sha, "marea-negra:alpha-bbbbbbb", "sha256:" + "1" * 64)))
                stack.enter_context(mock.patch.object(update, "active_revision", side_effect=[old_sha, sha, old_sha]))
                stack.enter_context(mock.patch.object(update, "image_metadata", return_value=("sha256:" + "1" * 64, old_sha)))
                stack.enter_context(mock.patch.object(update, "reject_rewind"))
                stack.enter_context(mock.patch.object(update, "prior_release", return_value=old_release))
                stack.enter_context(mock.patch.object(update, "read_state", return_value={}))
                stack.enter_context(mock.patch.object(update, "archive_release", return_value=base / "candidate"))
                stack.enter_context(mock.patch.object(update, "safe_env", side_effect=[(env_file, {"GAME_IMAGE": "candidate"}), (env_file, {})]))
                stack.enter_context(mock.patch.object(update, "prepare_image"))
                stack.enter_context(mock.patch.object(update, "compose", side_effect=compose))
                stack.enter_context(mock.patch.object(update, "run", return_value=mock.Mock(stdout="", returncode=0)))
                stack.enter_context(mock.patch.object(update, "local_status", return_value={"storage": {"durable": True, "accounts": True, "unsaved": 0, "errors": 0, "world": {"ready": True}}, "players": 0, "sockets": 0}))
                stack.enter_context(mock.patch.object(update, "is_idle_and_durable", return_value=True))
                stack.enter_context(mock.patch.object(update, "runtime_ready", side_effect=[False, True]))
                stack.enter_context(mock.patch.object(update, "CURRENT", current))
                stack.enter_context(mock.patch.object(update, "OPS", base))
                stack.enter_context(mock.patch.object(update, "STATE", base / "state.json"))
                stack.enter_context(mock.patch.object(update.time, "sleep"))
                with self.assertRaisesRegex(update.UpdateError, "prior release restored"):
                    update.deploy(sha)

            stop_index = next(i for i, event in enumerate(events) if event[1][0] == "stop")
            rollback_index = next(i for i, event in enumerate(events) if event[0] == old_release.resolve() and event[1][0] == "up")
            self.assertLess(stop_index, rollback_index)
            candidate_up = next(i for i, event in enumerate(events) if event[0] != old_release.resolve() and event[1][0] == "up")
            failed_stop = next(i for i, event in enumerate(events) if i > candidate_up and event[1][0] == "stop")
            self.assertLess(failed_stop, rollback_index)

    @unittest.skipUnless(os.name == "posix", "POSIX mode bits are not represented by Windows stat")
    def test_compose_environment_file_is_private_and_contains_no_private_values(self):
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp)
            (release / "package.json").write_text('{"version":"1.2.3"}')
            with mock.patch.object(update, "OPS", release), mock.patch.object(update, "ENV_FILE", Path("/etc/secret.env")):
                path, values = update.safe_env(release, "c" * 40)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("SECRET", path.read_text())
            self.assertEqual(values["WORLD_ID"], "marea-negra")


if __name__ == "__main__":
    unittest.main()
