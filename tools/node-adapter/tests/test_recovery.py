import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('runner', Path(__file__).resolve().parents[1] / 'run.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RecoveryTests(unittest.TestCase):
    def test_same_size_source_tampering_is_rejected(self):
        expected = {'bytes': 3, 'sha256': runner.digest(b'abc')}
        with self.assertRaisesRegex(RuntimeError, 'SHA256'):
            runner.verify(b'abd', expected, 'index.html')

    def test_git_blob_identity_is_independent_of_content_sha256(self):
        data = b'abc'
        expected = {'bytes': 3, 'sha256': runner.digest(data), 'gitBlob': '0' * 40}
        with self.assertRaisesRegex(RuntimeError, 'Git blob'):
            runner.verify(data, expected, 'index.html')

    def test_cached_source_is_verified_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = b'<meta name="frame-version" content="fixture">'
            sha = '1' * 40
            pin = {'commit': sha, 'frameVersion': 'fixture', 'files': {'index.html': {'bytes': len(data), 'sha256': runner.digest(data)}}}
            runner.write_json(root / 'verified-source.json', pin)
            snapshot = root / 'state/snapshots' / sha
            snapshot.mkdir(parents=True)
            (snapshot / 'index.html').write_bytes(data)
            with patch.object(runner, 'ROOT', root), patch.object(runner, 'get', side_effect=AssertionError('network forbidden')):
                result, metadata = runner.snapshot(root / 'state', True, None, None)
                self.assertEqual(result, snapshot)
                self.assertEqual(metadata['commit'], sha)
                (snapshot / 'index.html').write_bytes(data.replace(b'fixture', b'corrupt'))
                with self.assertRaisesRegex(RuntimeError, 'mismatch'):
                    runner.snapshot(root / 'state', True, None, None)

    def test_offline_main_cannot_be_mistaken_for_a_verified_pin(self):
        with patch.object(runner, 'get', side_effect=AssertionError('network forbidden')):
            with self.assertRaisesRegex(RuntimeError, 'Offline'):
                runner.snapshot(Path('/unused'), True, 'main', None)

    def test_failed_candidate_keeps_last_success(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            previous = {'status': 'passed', 'sourceCommit': 'old verified source'}
            runner.write_json(state / 'latest-compatible.json', previous)
            with patch.object(runner, 'native_driver', return_value={}), patch.object(runner, 'snapshot', return_value=(state, {})), patch.object(runner, 'qualify', side_effect=RuntimeError('incompatible API')), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = runner.main(['--ref', 'main', '--state-dir', str(state)])
            self.assertEqual(code, 1)
            self.assertEqual(runner.read_json(state / 'latest-compatible.json'), previous)
            failure = list(state.glob('runs/*/compatibility.json'))
            self.assertEqual(len(failure), 1)
            self.assertEqual(runner.read_json(failure[0])['status'], 'failed')

    def test_exit_zero_without_completed_scenario_is_not_a_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'phase'
            def incomplete(*args, **kwargs):
                runner.write_json(output / 'results.json', {'completed': False, 'errors': []})
                class Result:
                    returncode = 0
                return Result()
            with patch.object(runner.subprocess, 'run', side_effect=incomplete):
                with self.assertRaisesRegex(RuntimeError, 'every qualification step'):
                    runner.run_phase(Path(directory), output, {'FRAME_EXPECT_COMMIT': '1' * 40})


if __name__ == '__main__':
    unittest.main()
