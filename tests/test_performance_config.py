import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from local_translator.config import Settings
from local_translator.llama_client import LlamaServerClient
from local_translator.runtime import LlamaCppProcessManager


class PerformanceConfigTests(unittest.TestCase):
    def test_default_and_environment_configuration(self):
        defaults = Settings()
        defaults.validate()
        self.assertEqual((defaults.batch_size, defaults.ubatch_size, defaults.kv_cache_type), (2048, 512, "f16"))
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "LAT_BATCH_SIZE": "1024", "LAT_UBATCH_SIZE": "256", "LAT_FLASH_ATTENTION": "on",
            "LAT_KV_CACHE_TYPE": "q8_0", "LAT_CACHE_PROMPT": "false",
            "LAT_MAX_PENDING_TRANSLATIONS": "3", "LAT_QUEUE_WAIT_TIMEOUT": "45.5",
        }, clear=True):
            settings = Settings.from_file(Path(directory) / "missing.json")
        self.assertEqual((settings.batch_size, settings.ubatch_size, settings.flash_attention), (1024, 256, "on"))
        self.assertEqual(settings.kv_cache_type, "q8_0")
        self.assertFalse(settings.cache_prompt)
        self.assertEqual((settings.max_pending_translations, settings.queue_wait_timeout_seconds), (3, 45.5))

    def test_invalid_config_is_rejected_before_startup(self):
        invalid = [
            {"batch_size": True}, {"batch_size": 16}, {"batch_size": 8193},
            {"ubatch_size": 15}, {"ubatch_size": 2049}, {"batch_size": 128, "ubatch_size": 256},
            {"max_pending_translations": 0}, {"max_pending_translations": 33},
            {"max_pending_translations": 1.5}, {"queue_wait_timeout_seconds": 0},
            {"queue_wait_timeout_seconds": float("nan")}, {"queue_wait_timeout_seconds": float("inf")},
            {"flash_attention": "sometimes"}, {"kv_cache_type": "q4_0"}, {"cache_prompt": "false"},
            {"kv_cache_type": "q8_0", "flash_attention": "off"},
        ]
        for values in invalid:
            with self.subTest(values=values), self.assertRaises(ValueError):
                Settings(**values).validate()
        with patch.dict(os.environ, {"LAT_CACHE_PROMPT": "maybe"}, clear=True), self.assertRaises(ValueError):
            Settings().apply_environment()

    def test_runtime_uses_one_full_context_slot_and_configured_batching(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = Settings(runtime_root=directory, batch_size=1024, ubatch_size=256,
                                flash_attention="on", kv_cache_type="q8_0", cache_prompt=False)
            manager = LlamaCppProcessManager(settings)
            manager._server_executable = lambda: Path(directory) / "llama-server.exe"
            manager._verified = Mock(return_value=True)
            process = Mock()
            process.poll.return_value = None
            with patch("local_translator.runtime.subprocess.Popen", return_value=process) as spawn, \
                 patch("local_translator.runtime.LlamaServerClient.is_ready", return_value=True):
                try:
                    manager.ensure_server()
                    args = spawn.call_args.args[0]
                    for flag, expected in {
                        "--parallel": "1", "-c": "8192", "--batch-size": "1024",
                        "--ubatch-size": "256", "--flash-attn": "on",
                        "--cache-type-k": "q8_0", "--cache-type-v": "q8_0",
                    }.items():
                        self.assertEqual(args[args.index(flag) + 1], expected)
                    self.assertIn("--no-cache-prompt", args)
                    self.assertIn("--perf", args)
                    status = manager.status()["inference_config"]
                    self.assertEqual(status["parallel"], 1)
                    self.assertFalse(status["cache_prompt"])
                    self.assertEqual(status["context_size"], 8192)
                finally:
                    manager.shutdown()

    def test_prompt_cache_setting_reaches_both_upstream_protocols(self):
        settings = Settings(cache_prompt=False)
        client = LlamaServerClient("http://127.0.0.1:1234", settings)
        with patch.object(client, "_request", return_value={}) as request:
            client.chat("model", [], {})
            self.assertIs(request.call_args.args[2]["cache_prompt"], False)
            client.chat("model", [], {"cache_prompt": True})
            self.assertIs(request.call_args.args[2]["cache_prompt"], True)
        lines = [b'data: {"choices":[{"delta":{"content":"result"},"finish_reason":"stop"}]}', b'data: [DONE]']
        for options, expected in (({}, False), ({"cache_prompt": True}, True)):
            with patch("local_translator.llama_client.stream_lines", return_value=iter_lines(lines)) as stream:
                list(client.chat_stream("model", [], options))
                body = json.loads(stream.call_args.args[1])
                self.assertIs(body["cache_prompt"], expected)
                self.assertTrue(body["timings_per_token"])


def iter_lines(lines):
    yield from lines


if __name__ == "__main__":
    unittest.main()
