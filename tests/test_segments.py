import re
import unittest

from local_translator.config import Settings
from local_translator.engine import TranslationEngine, TranslationOutputError, TranslationRequestError
from local_translator.segments import split_source


class EchoClient:
    def __init__(self):
        self.calls = 0
        self.closed = 0
        self.truncate_first = False

    def resolve_model(self):
        return "test-model"

    def chat_stream(self, model, messages, options):
        self.calls += 1
        source = messages[0]["content"].split("[Source Text]\n")[1].split("\n[End Source Text]")[0]
        try:
            yield {"message": {"content": source}}
            yield {"done": True, "done_reason": "length" if self.truncate_first and self.calls == 1 else "stop", "eval_count": 10}
        finally:
            self.closed += 1


class Manager:
    def __init__(self):
        self.client = EchoClient()

    def ensure_server(self):
        return self.client


class SegmentTests(unittest.TestCase):
    def test_distinct_paragraphs_never_share_model_request(self):
        self.assertEqual(split_source("First.\n\nSecond.\n\nThird.", 1200), ["First.\n\n", "Second.\n\n", "Third."])

    def test_repeated_sentences_do_not_share_a_chunk(self):
        sentence = "The local translator processes every document on this computer. "
        source = sentence * 40
        parts = split_source(source, 1200)
        self.assertEqual("".join(parts), source)
        self.assertEqual(len(parts), 40)
        self.assertTrue(all(part.count("The local translator") == 1 for part in parts))

    def test_split_rejoins_exactly_and_keeps_math_code_and_urls(self):
        formula = r"$$\boldsymbol{x} \in A, \|x\|^2$$"
        code = "```python\nprint('$x$')\n```"
        source = ("这是第一句。\n\n" + formula + " https://example.com/abc " + code + "\r\n") * 200
        parts = split_source(source, 100)
        self.assertEqual("".join(parts), source)
        self.assertGreater(len(parts), 1)
        self.assertEqual(sum(part.count(formula) for part in parts), 200)
        self.assertEqual(sum(part.count(code) for part in parts), 200)

    def test_long_unbroken_input_and_unicode(self):
        source = "中文🙂abc" * 5000
        parts = split_source(source, 1200)
        self.assertEqual("".join(parts), source)
        self.assertTrue(all(len(part) < 1201 for part in parts))

    def test_long_translation_progress_and_nonstream_agree(self):
        manager = Manager()
        engine = TranslationEngine(Settings(retry_on_bad_output=False), manager)
        source = ("这是测试文本。\n\n" * 4000).strip()
        events = list(engine.translate_stream({"text": source, "target_language": "English"}))
        self.assertEqual(events[-1]["translation"], source)
        progress = [event["completed_chars"] for event in events if "completed_chars" in event]
        self.assertEqual(progress, sorted(progress))
        self.assertEqual(progress[-1], len(source))
        self.assertEqual(manager.client.calls, 1)  # identical paragraphs reuse this request's result
        self.assertEqual(manager.client.closed, manager.client.calls)
        self.assertEqual(engine.translate({"text": source, "target_language": "English"}).text, source)

    def test_truncation_subdivides_only_failed_segment(self):
        manager = Manager()
        manager.client.truncate_first = True
        engine = TranslationEngine(Settings(retry_on_bad_output=False), manager)
        source = "测试分段。" * 120
        events = list(engine.translate_stream({"text": source, "target_language": "English"}))
        self.assertEqual(events[-1]["translation"], source)
        self.assertTrue(any("segment_subdivided" in event.get("issues", []) for event in events))

    def test_input_limit_and_context_budget(self):
        engine = TranslationEngine(Settings(max_input_chars=10), Manager())
        with self.assertRaises(TranslationRequestError):
            list(engine.translate_stream({"text": "a" * 11, "target_language": "English"}))
        engine = TranslationEngine(Settings(num_ctx=100), Manager())
        with self.assertRaisesRegex(TranslationRequestError, "context_budget"):
            list(engine.translate_stream({"text": "hello", "target_language": "English"}))

    def test_disconnect_closes_upstream_generator(self):
        manager = Manager()
        engine = TranslationEngine(Settings(), manager)
        stream = engine.translate_stream({"text": "测试" * 3000, "target_language": "English"})
        for event in stream:
            if event["type"] == "segment_complete":
                break
        stream.close()
        self.assertEqual(manager.client.calls, 1)
        self.assertEqual(manager.client.closed, 1)

    def test_busy_request_rejected_and_lock_released_on_close(self):
        engine = TranslationEngine(Settings(), Manager())
        body = {"text": "hello", "target_language": "Chinese"}
        first = engine.translate_stream(body)
        next(first)
        with self.assertRaisesRegex(TranslationRequestError, "translation_busy"):
            list(engine.translate_stream(body))
        first.close()
        self.assertEqual(list(engine.translate_stream(body))[-1]["type"], "complete")
