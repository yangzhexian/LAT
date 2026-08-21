import unittest

from local_translator.config import Settings
from local_translator.engine import TranslationEngine


class FakeLlamaClient:
    active_model = "hy-mt2-7b:q6_k"

    def resolve_model(self):
        return self.active_model

    def chat_stream(self, model, messages, options, keep_alive=None):
        yield {"message": {"content": "Hello"}}
        yield {
            "message": {"content": " world."},
            "done": True,
            "done_reason": "stop",
            "eval_count": 3,
            "eval_duration": 1_000_000_000,
        }


class FakeManager:
    def __init__(self):
        self.client = FakeLlamaClient()

    def ensure_server(self):
        return self.client


class StreamingTests(unittest.TestCase):
    def test_stream_buffers_and_returns_checked_translation(self):
        settings = Settings(retry_on_bad_output=False)
        engine = TranslationEngine(settings, manager=FakeManager())
        events = list(engine.translate_stream({"text": "你好", "source_language": "Chinese", "target_language": "English"}))
        self.assertEqual(events[0]["type"], "attempt")
        self.assertEqual(events[-1]["type"], "complete")
        self.assertEqual(events[-1]["translation"], "Hello world.")
        self.assertEqual(events[-1]["metrics"]["generated_tokens"], 3)
        self.assertEqual(events[-1]["metrics"]["tokens_per_second"], 3.0)


if __name__ == "__main__":
    unittest.main()