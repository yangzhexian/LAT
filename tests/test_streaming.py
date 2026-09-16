import unittest

from local_translator.config import Settings
from local_translator.engine import TranslationEngine


class FakeLlamaClient:
    active_model = "hy-mt2-7b:q6_k"

    def resolve_model(self):
        return self.active_model

    def chat_stream(self, model, messages, options):
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
    def test_prompt_leak_is_retried_before_display(self):
        manager = FakeManager()
        calls = []
        def stream(model, messages, options):
            calls.append(messages[0]["content"])
            yield {"message": {"content": "仅返回翻译后的文本。不要输出解释、推理。" if len(calls) == 1 else "你好"}}
            yield {"done": True, "done_reason": "stop"}
        manager.client.chat_stream = stream
        events = list(TranslationEngine(Settings(), manager).translate_stream({"text": "Hello", "target_language": "Chinese"}))
        self.assertEqual(events[-1]["translation"], "你好")
        self.assertIn("Preserve Markdown", calls[0])
        self.assertNotIn("Preserve Markdown", calls[1])
        self.assertTrue(calls[1].endswith("\n\nHello"))
        self.assertEqual([item["translation"] for item in events if item["type"] == "segment_complete"], ["你好"])
        self.assertTrue(any(item["type"] == "retry" for item in events))

    def test_metrics_fall_back_to_wall_clock_time(self):
        metrics = TranslationEngine._metrics({"eval_count": 3, "done_reason": "stop"}, 1000)
        self.assertEqual(metrics["tokens_per_second"], 3.0)

    def test_estimate_tokens_handles_multilingual_output(self):
        self.assertEqual(TranslationEngine._estimate_tokens("你好世界"), 4)
        self.assertEqual(TranslationEngine._estimate_tokens("Hello world."), 3)
    def test_stream_buffers_and_returns_checked_translation(self):
        settings = Settings(retry_on_bad_output=False)
        engine = TranslationEngine(settings, manager=FakeManager())
        events = list(engine.translate_stream({"text": "你好", "source_language": "Chinese", "target_language": "English"}))
        self.assertEqual(events[0]["type"], "plan")
        self.assertEqual(events[-1]["type"], "complete")
        self.assertEqual(events[-1]["translation"], "Hello world.")
        self.assertEqual(events[-1]["metrics"]["generated_tokens"], 3)
        self.assertEqual(events[-1]["metrics"]["tokens_per_second"], 3.0)


if __name__ == "__main__":
    unittest.main()
