import hashlib
import tempfile
import urllib.error
import unittest
from pathlib import Path
from unittest.mock import patch

from local_translator.catalog import DownloadAsset
from local_translator.config import Settings
from local_translator.errors import LlamaError
from local_translator.runtime import LlamaCppProcessManager


class FakeResponse:
    status = 200

    def __init__(self, payload: bytes):
        self.payload = payload
        self.headers = {"Content-Length": str(len(payload))}
        self.reads = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _size: int) -> bytes:
        if self.reads:
            return b""
        self.reads += 1
        return self.payload


class RuntimeDownloadTests(unittest.TestCase):
    def test_checksum_mismatch_removes_partial_file(self):
        payload = b"corrupt archive"
        asset = DownloadAsset("runtime", "https://example.invalid/runtime.zip", "0" * 64)
        with tempfile.TemporaryDirectory() as directory:
            manager = LlamaCppProcessManager(Settings(runtime_root=directory))
            destination = Path(directory) / "runtime.zip"
            with patch("local_translator.downloader.urllib.request.urlopen", return_value=FakeResponse(payload)):
                with self.assertRaises(LlamaError):
                    list(manager._download_asset(asset, destination, "runtime"))

            self.assertFalse(destination.with_suffix(".zip.part").exists())

    def test_runtime_progress_uses_response_content_length(self):
        payload = b"runtime archive"
        asset = DownloadAsset("runtime", "https://example.invalid/runtime.zip", hashlib.sha256(payload).hexdigest())
        with tempfile.TemporaryDirectory() as directory:
            manager = LlamaCppProcessManager(Settings(runtime_root=directory))
            destination = Path(directory) / "runtime.zip"
            with patch("local_translator.downloader.urllib.request.urlopen", return_value=FakeResponse(payload)):
                events = list(manager._download_asset(asset, destination, "runtime"))

        downloading = next(event for event in events if event["status"] == "downloading")
        self.assertEqual(downloading["total_bytes"], len(payload))
        self.assertEqual(downloading["percent"], 100.0)
        self.assertIn("speed_mib_per_second", downloading)

    def test_retries_after_connection_refused_and_resumes(self):
        payload = b"runtime archive after reconnect"
        asset = DownloadAsset("runtime", "https://example.invalid/runtime.zip", hashlib.sha256(payload).hexdigest())
        with tempfile.TemporaryDirectory() as directory:
            manager = LlamaCppProcessManager(Settings(runtime_root=directory))
            destination = Path(directory) / "runtime.zip"
            responses = [urllib.error.URLError("connection refused"), FakeResponse(payload)]
            with patch("local_translator.downloader.urllib.request.urlopen", side_effect=responses), patch("local_translator.downloader.time.sleep"):
                events = list(manager._download_asset(asset, destination, "runtime"))

            self.assertTrue(destination.exists())
            self.assertIn("retrying", [event["status"] for event in events])
            self.assertEqual(events[-1]["status"], "verified")

    def test_model_source_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = LlamaCppProcessManager(Settings(runtime_root=directory))
            destination = Path(directory) / "HY-MT2-7B-Q6_K.gguf"
            fallback_events = iter([
                {"type": "download", "phase": "model", "status": "verified", "percent": 100.0},
            ])
            with patch.object(manager, "_download_asset", side_effect=[LlamaError("Hugging Face unavailable"), fallback_events]):
                events = list(manager._download_model(destination, 1, 1))

        self.assertEqual(events[0]["status"], "switching_source")
        self.assertEqual(events[1]["status"], "verified")

    def test_install_stream_emits_complete_only_after_model_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = LlamaCppProcessManager(Settings(runtime_root=directory))
            manager._server_executable = lambda: Path(directory) / "llama-server.exe"
            manager._download_model = lambda *_args: iter([
                {"type": "download", "phase": "model", "status": "verified", "percent": 100.0},
            ])
            manager._verified = lambda *_args: True
            events = list(manager.install_stream())

        self.assertEqual(events[-1]["status"], "complete")
        self.assertEqual(events[-1]["file_count"], 3)
if __name__ == "__main__":
    unittest.main()
