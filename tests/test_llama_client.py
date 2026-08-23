import hashlib
import tempfile
import urllib.error
import unittest
from pathlib import Path
from unittest.mock import patch

from local_translator.config import Settings
from local_translator.llama_client import DownloadAsset, LlamaCppProcessManager


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


class LlamaDownloadTests(unittest.TestCase):
    def test_runtime_progress_uses_response_content_length(self):
        payload = b"runtime archive"
        asset = DownloadAsset("runtime", "https://example.invalid/runtime.zip", hashlib.sha256(payload).hexdigest())
        with tempfile.TemporaryDirectory() as directory:
            manager = LlamaCppProcessManager(Settings(runtime_root=directory))
            destination = Path(directory) / "runtime.zip"
            with patch("local_translator.llama_client.urllib.request.urlopen", return_value=FakeResponse(payload)):
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
            with patch("local_translator.llama_client.urllib.request.urlopen", side_effect=responses), patch("local_translator.llama_client.time.sleep"):
                events = list(manager._download_asset(asset, destination, "runtime"))

            self.assertTrue(destination.exists())
            self.assertIn("retrying", [event["status"] for event in events])
            self.assertEqual(events[-1]["status"], "verified")

if __name__ == "__main__":
    unittest.main()