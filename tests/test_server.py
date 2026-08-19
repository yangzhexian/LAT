import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import Mock

from local_translator.config import Settings
from local_translator.server import App, RequestHandler


class ServerTests(unittest.TestCase):
    def setUp(self):
        settings = Settings(port=0)
        app = App(settings)
        app.engine.translate = Mock(return_value=type("Result", (), {"text": "Hello", "model": "hy-mt2-7b:q6_k", "issues": []})())
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), RequestHandler)
        self.httpd.app = app
        app.httpd = self.httpd
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)

    def test_openai_compatible_completion(self):
        request = urllib.request.Request(
            self.url + "/v1/chat/completions",
            data=json.dumps({"messages": [{"role": "user", "content": "Translate into English: 你好"}]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            body = json.loads(response.read().decode())
        self.assertEqual(body["choices"][0]["message"]["content"], "Hello")


if __name__ == "__main__":
    unittest.main()

