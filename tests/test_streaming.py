import unittest
from unittest.mock import Mock

from local_translator.config import Settings
from local_translator.engine import TranslationEngine, TranslationRequestError, TranslationOutputError
from local_translator.errors import ModelNotReadyError


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

    def ensure_server(self, **_kwargs):
        return self.client


class StreamingTests(unittest.TestCase):
    def test_busy_request_does_not_cancel_or_replace_active_job(self):
        engine = TranslationEngine(Settings(), FakeManager())
        active = engine.translate_stream({"text": "你好", "target_language": "English"})
        plan = next(active)
        job = engine._active_job
        try:
            with self.assertRaises(TranslationRequestError) as raised:
                list(engine.translate_stream({"text": "另一条原文", "require_ready": True}))
            self.assertEqual(raised.exception.code, "translation_busy")
            self.assertIs(engine._active_job, job)
            self.assertFalse(job.cancel.is_set())
            self.assertEqual(list(engine._jobs), [plan["job_id"]])
            self.assertEqual(list(active)[-1]["translation"], "Hello world.")
        finally:
            active.close()

    def test_cancel_id_is_isolated_from_active_job(self):
        engine = TranslationEngine(Settings(), FakeManager())
        other = engine._get_job({"text": "先前的原文", "target_language": "English"})
        active = engine.translate_stream({"text": "你好", "target_language": "English"})
        plan = next(active)
        try:
            engine.cancel_translation(other.id)
            self.assertTrue(other.cancel.is_set())
            self.assertFalse(engine._jobs[plan["job_id"]].cancel.is_set())
            with self.assertRaises(TranslationRequestError) as raised:
                engine.cancel_translation("unknown-id")
            self.assertEqual(raised.exception.code, "checkpoint_expired")
            self.assertFalse(engine._jobs[plan["job_id"]].cancel.is_set())
            self.assertEqual(list(active)[-1]["type"], "complete")
        finally:
            active.close()

    def test_ready_only_request_does_not_auto_start_model(self):
        manager = FakeManager()
        manager.require_ready_server = Mock(side_effect=ModelNotReadyError("not enabled"))
        manager.ensure_server = Mock()
        engine = TranslationEngine(Settings(), manager)
        with self.assertRaises(ModelNotReadyError) as raised:
            list(engine.translate_stream({"text": "$x$", "require_ready": True}))
        self.assertEqual(raised.exception.code, "model_not_ready")
        manager.ensure_server.assert_not_called()
        self.assertEqual(engine._jobs, {})
        self.assertFalse(engine._translation_lock.locked())

    def test_unloaded_model_after_plan_is_not_restarted(self):
        manager = FakeManager()
        manager.require_ready_server = Mock(side_effect=[manager.client, ModelNotReadyError("not enabled")])
        manager.ensure_server = Mock()
        engine = TranslationEngine(Settings(), manager)
        active = engine.translate_stream({"text": "你好", "target_language": "English", "require_ready": True})
        self.assertEqual(next(active)["type"], "plan")
        with self.assertRaises(TranslationOutputError) as raised:
            list(active)
        self.assertEqual(raised.exception.code, "model_not_ready")
        manager.ensure_server.assert_not_called()

    def test_ready_only_success_and_legacy_auto_start(self):
        manager = FakeManager()
        manager.require_ready_server = Mock(return_value=manager.client)
        manager.ensure_server = Mock(return_value=manager.client)
        engine = TranslationEngine(Settings(), manager)
        result = engine.translate({"text": "你好", "target_language": "English", "require_ready": True})
        self.assertEqual(result.text, "Hello world.")
        manager.ensure_server.assert_not_called()
        result = engine.translate({"text": "你好", "target_language": "English"})
        self.assertEqual(result.text, "Hello world.")
        manager.ensure_server.assert_called_once()

    def test_require_ready_rejects_non_boolean(self):
        engine = TranslationEngine(Settings(), FakeManager())
        with self.assertRaises(TranslationRequestError) as raised:
            list(engine.translate_stream({"text": "你好", "require_ready": "false"}))
        self.assertEqual(raised.exception.code, "invalid_request")

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
