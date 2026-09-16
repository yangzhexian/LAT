import unittest
from unittest.mock import patch

from local_translator.config import Settings
from local_translator.llama_client import LlamaServerClient


class StreamingResponse:
    def __init__(self, lines: list[bytes]):
        self.lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def __iter__(self):
        return iter(self.lines)


class LlamaServerClientTests(unittest.TestCase):
    def test_eof_without_finish_reason_is_not_success(self):
        from local_translator.errors import LlamaError
        response = StreamingResponse([b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n'])
        client = LlamaServerClient("http://127.0.0.1:1234", Settings())
        with patch("local_translator.llama_client.urllib.request.urlopen", return_value=response):
            with self.assertRaisesRegex(LlamaError, "incomplete_stream"):
                list(client.chat_stream("model", [], {}))

    def test_stream_emits_one_complete_event_with_usage(self):
        response = StreamingResponse(
            [
                b'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n',
                b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
                b'data: {"choices":[],"usage":{"completion_tokens":3}}\n',
                b"data: [DONE]\n",
            ]
        )
        client = LlamaServerClient("http://127.0.0.1:1234", Settings())
        with patch("local_translator.llama_client.urllib.request.urlopen", return_value=response):
            events = list(client.chat_stream("model", [], {}))

        complete = [event for event in events if event.get("done")]
        self.assertEqual(len(complete), 1)
        self.assertEqual(complete[0]["done_reason"], "stop")
        self.assertEqual(complete[0]["eval_count"], 3)


if __name__ == "__main__":
    unittest.main()
