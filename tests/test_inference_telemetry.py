import json
import threading
import unittest
from unittest.mock import patch

from local_translator.config import Settings
from local_translator.engine import TranslationEngine
from local_translator.errors import LlamaError
from local_translator.inference_telemetry import InferenceTelemetry, response_metrics
from local_translator.llama_client import LlamaServerClient


class StreamingResponse:
    def __init__(self, events):
        self.events = events

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def __iter__(self):
        for event in self.events:
            yield b"data: " + (event.encode() if isinstance(event, str) else json.dumps(event).encode()) + b"\n"


class InferenceTelemetryTests(unittest.TestCase):
    def test_cached_prompt_rate_uses_evaluated_tokens(self):
        metrics = response_metrics({"usage": {"prompt_tokens": 100, "completion_tokens": 5},
            "timings": {"prompt_n": 10, "cache_n": 90, "prompt_ms": 500, "predicted_ms": 1000}})
        self.assertEqual(metrics["prompt_tokens"], 100)
        self.assertEqual(metrics["prompt_tokens_per_second"], 20)
        self.assertEqual(metrics["tokens_per_second"], 5)
        self.assertEqual(metrics["total_tokens"], 105)

    def test_unknown_or_invalid_counters_do_not_become_zero_or_nan(self):
        metrics = response_metrics({"usage": {"prompt_tokens": True, "completion_tokens": -1, "total_tokens": 2.5},
            "timings": {"predicted_ms": float("nan"), "prompt_per_second": float("inf")}})
        self.assertTrue(all(value is None for value in metrics.values()))
        zero = response_metrics({"usage": {"prompt_tokens": 0, "completion_tokens": 0}})
        self.assertEqual(zero["total_tokens"], 0)
        self.assertIsNone(zero["tokens_per_second"])
        huge = response_metrics({"usage": {"completion_tokens": 10**400}})
        self.assertIsNone(huge["generated_tokens"])
        tiny_duration = response_metrics({"usage": {"completion_tokens": 1},
            "timings": {"predicted_ms": 5e-324, "prompt_n": 1, "prompt_ms": 5e-324}})
        self.assertIsNone(tiny_duration["tokens_per_second"])
        self.assertIsNone(tiny_duration["prompt_tokens_per_second"])

    def test_partial_counts_contribute_only_a_known_session_lower_bound(self):
        for usage, known_total in (({"prompt_tokens": 5}, 5), ({"completion_tokens": 7}, 7), ({"total_tokens": 13}, 13)):
            telemetry = InferenceTelemetry()
            call = telemetry.begin("model", job_id=None, segment_index=None, attempt=1)
            telemetry.observe(call, {"done": True, "usage": usage})
            telemetry.finish(call, "completed")
            snapshot = telemetry.snapshot()
            self.assertEqual(snapshot["summary"]["total_tokens"], known_total)
            self.assertEqual(snapshot["summary"]["unknown_token_calls"], 1)

    def test_usage_without_timing_never_claims_decode_rate(self):
        metrics = response_metrics({"usage": {"prompt_tokens": 20, "completion_tokens": 10}})
        self.assertIsNone(metrics["tokens_per_second"])
        self.assertIsNone(metrics["prompt_tokens_per_second"])

    def test_stream_handles_timings_and_usage_outside_content_packets(self):
        response = StreamingResponse([
            {"choices": [{"delta": {"content": "a whole sentence"}}], "timings": {"predicted_n": 2, "predicted_ms": 100}},
            {"choices": [{"delta": {}, "finish_reason": "stop"}], "timings": {"prompt_n": 3, "cache_n": 7, "prompt_ms": 50}},
            {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14},
             "timings": {"predicted_n": 4, "predicted_ms": 200, "predicted_per_second": 20}},
            "[DONE]",
        ])
        client = LlamaServerClient("http://127.0.0.1:1234", Settings())
        with patch("local_translator.llama_client.stream_lines", side_effect=lambda *args: (line for line in response)) as request:
            events = list(client.chat_stream("model", [], {}))
        payload = json.loads(request.call_args.args[1])
        self.assertTrue(payload["timings_per_token"])
        self.assertTrue(payload["stream_options"]["include_usage"])
        final = events[-1]
        self.assertTrue(final["done"])
        self.assertEqual(final["inference_metrics"]["prompt_tokens"], 10)
        self.assertEqual(final["inference_metrics"]["generated_tokens"], 4)
        self.assertEqual(final["inference_metrics"]["tokens_per_second"], 20)
        self.assertEqual(final["inference_metrics"]["prompt_tokens_per_second"], 60)
        self.assertEqual(final["eval_duration"], 200_000_000)
        self.assertEqual(len([event for event in events if event.get("done")]), 1)

    def test_active_phase_and_session_total_do_not_count_fragments(self):
        telemetry = InferenceTelemetry()
        call = telemetry.begin("model", job_id="job", segment_index=1, attempt=1)
        self.assertEqual(telemetry.snapshot()["active"]["phase"], "prefill")
        telemetry.observe(call, {"message": {"content": "many tokens in one fragment"}})
        active = telemetry.snapshot()["active"]
        self.assertEqual(active["phase"], "decode")
        self.assertIsNotNone(active["first_token_ms"])
        self.assertIsNone(active["generated_tokens"])
        event = {"done": True, "usage": {"prompt_tokens": 9, "completion_tokens": 6}}
        telemetry.observe(call, event)
        telemetry.observe(call, event)
        telemetry.finish(call, "completed")
        telemetry.finish(call, "completed")
        snapshot = telemetry.snapshot()
        self.assertIsNone(snapshot["active"])
        self.assertEqual(snapshot["summary"]["calls"], 1)
        self.assertEqual(snapshot["summary"]["total_tokens"], 15)
        self.assertEqual(snapshot["summary"]["unknown_token_calls"], 0)
        self.assertNotIn("content", json.dumps(snapshot))

    def test_cancelled_partial_usage_is_a_known_lower_bound(self):
        telemetry = InferenceTelemetry()
        call = telemetry.begin("model", job_id=None, segment_index=None, attempt=1)
        telemetry.observe(call, {"timings": {"prompt_n": 5, "cache_n": 10, "predicted_n": 2}})
        telemetry.finish(call, "cancelled")
        snapshot = telemetry.snapshot()
        self.assertEqual(snapshot["latest"]["generated_tokens"], 2)
        self.assertFalse(snapshot["latest"]["tokens_complete"])
        self.assertEqual(snapshot["summary"]["unknown_token_calls"], 1)
        self.assertEqual(snapshot["summary"]["cancelled_calls"], 1)

    def test_history_bounded_without_losing_session_cumulative_totals(self):
        telemetry = InferenceTelemetry(history_limit=2)
        for _ in range(4):
            call = telemetry.begin("model", job_id=None, segment_index=None, attempt=1)
            telemetry.observe(call, {"done": True, "usage": {"prompt_tokens": 3, "completion_tokens": 2}})
            telemetry.finish(call, "completed")
        snapshot = telemetry.snapshot()
        self.assertEqual(len(snapshot["history"]), 2)
        self.assertEqual(snapshot["summary"]["calls"], 4)
        self.assertEqual(snapshot["summary"]["total_tokens"], 20)

    def test_engine_tracks_quality_retries_separately(self):
        class Client:
            def resolve_model(self):
                return "model"
            def chat_stream(self, model, messages, options):
                yield {"message": {"content": "仅返回翻译后的文本。不要输出解释、推理。" if options["temperature"] else "你好"}}
                yield {"done": True, "done_reason": "stop", "inference_metrics": response_metrics(
                    {"usage": {"prompt_tokens": 10, "completion_tokens": 3}})}
        class Manager:
            def ensure_server(self, **_kwargs):
                return Client()
        engine = TranslationEngine(Settings(), Manager())
        result = engine.translate({"text": "Hello", "target_language": "Chinese"})
        self.assertEqual(result.text, "你好")
        snapshot = engine.inference.snapshot()
        self.assertEqual([record["attempt"] for record in snapshot["history"]], [1, 2])
        self.assertEqual(snapshot["summary"]["total_tokens"], 26)
        self.assertEqual(snapshot["summary"]["completed_calls"], 2)

    def test_formula_only_document_does_not_count_as_model_inference(self):
        engine = TranslationEngine(Settings(), object())
        result = engine.translate({"text": "$$x^2 + y^2 = z^2$$", "target_language": "English"})
        self.assertEqual(result.text, "$$x^2 + y^2 = z^2$$")
        self.assertEqual(engine.inference.snapshot()["summary"]["calls"], 0)

    def test_closed_or_failed_stream_records_unknown_usage(self):
        class Client:
            def chat_stream(self, *_args):
                yield {"message": {"content": "Hello"}}
                raise LlamaError("connection lost")
        engine = TranslationEngine(Settings(), object())
        stream = engine._tracked_stream(Client(), "model", [], {}, 1, threading.Event())
        next(stream)
        stream.close()
        self.assertEqual(engine.inference.snapshot()["latest"]["status"], "cancelled")
        with self.assertRaises(LlamaError):
            list(engine._tracked_stream(Client(), "model", [], {}, 1, threading.Event()))
        snapshot = engine.inference.snapshot()
        self.assertEqual(snapshot["latest"]["status"], "failed")
        self.assertIsNone(snapshot["latest"]["generated_tokens"])
        self.assertEqual(snapshot["summary"]["unknown_token_calls"], 2)

    def test_cancel_observes_reported_metrics_before_stopping(self):
        cancel = threading.Event()
        class Client:
            def chat_stream(self, *_args):
                cancel.set()
                yield {"timings": {"prompt_n": 10, "cache_n": 0, "predicted_n": 3}}
        from local_translator.jobs import TranslationCancelled
        engine = TranslationEngine(Settings(), object())
        with self.assertRaises(TranslationCancelled):
            list(engine._tracked_stream(Client(), "model", [], {}, 1, cancel))
        snapshot = engine.inference.snapshot()
        self.assertEqual(snapshot["latest"]["generated_tokens"], 3)
        self.assertEqual(snapshot["summary"]["unknown_token_calls"], 1)


if __name__ == "__main__":
    unittest.main()
