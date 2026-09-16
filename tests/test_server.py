import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import Mock, patch

from local_translator.config import Settings
from local_translator.server import App, RequestHandler


class ServerTests(unittest.TestCase):
    def setUp(self):
        settings = Settings(port=0)
        app = App(settings)
        app.engine.translate = Mock(return_value=type("Result", (), {"text": "Hello", "model": "hy-mt2-7b:q6_k", "issues": [], "metrics": None})())
        app.engine.manager.install_stream = Mock(return_value=iter([
            {"type": "download", "phase": "runtime", "status": "installed", "percent": 100},
            {"type": "download", "phase": "model", "status": "downloading", "percent": 40, "total_bytes": 100, "completed_bytes": 40},
            {"type": "download", "phase": "model", "status": "installed", "percent": 100},
            {"type": "download", "phase": "model", "status": "complete", "percent": 100},
        ]))
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

    def test_telemetry_endpoint(self):
        sample = {"timestamp": 1, "gpus": [{"id": "gpu", "power_w": None}], "message": ""}
        self.httpd.app.telemetry.sample = Mock(return_value=sample)
        with urllib.request.urlopen(self.url + "/admin/telemetry") as response:
            self.assertEqual(json.loads(response.read()), sample)

    def test_translation_cancel_endpoint(self):
        engine = self.httpd.app.engine
        engine.cancel_translation = Mock()
        request = urllib.request.Request(self.url + "/translate/cancel",
            data=json.dumps({"job_id": "job-1"}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request) as response:
            self.assertEqual(json.loads(response.read())["status"], "cancelling")
        engine.cancel_translation.assert_called_once_with("job-1")

    def test_download_cancel_endpoint(self):
        request = urllib.request.Request(
            self.url + "/admin/download/cancel",
            data=b"",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            body = json.loads(response.read().decode())
        self.assertEqual(body["status"], "cancelling")
    def test_model_download_stream_reports_progress(self):
        request = urllib.request.Request(
            self.url + "/admin/download",
            data=json.dumps({"model": "hy-mt2-7b:q6_k"}).encode(),
            headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            body = response.read().decode()
        self.assertIn('"phase": "model"', body)
        self.assertIn('"percent": 40', body)
        self.assertIn('"status": "complete"', body)


    @patch("local_translator.server.inspect_download_environment")
    def test_environment_accepts_selected_model_query(self, inspect):
        inspect.return_value = {"model": "hy-mt2-7b:q8_0", "status": "insufficient"}

        with urllib.request.urlopen(self.url + "/admin/environment?model=hy-mt2-7b%3Aq8_0") as response:
            body = json.loads(response.read().decode())

        self.assertEqual(body["model"], "hy-mt2-7b:q8_0")
        inspect.assert_called_once_with("hy-mt2-7b:q8_0")
if __name__ == "__main__":
    unittest.main()