import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import Mock, patch

from local_translator.config import Settings
from local_translator.engine import TranslationRequestError
from local_translator.errors import ModelNotReadyError
from local_translator.server import App, RequestHandler


class ServerTests(unittest.TestCase):
    def setUp(self):
        settings = Settings(port=0, admin_token="test-admin-secret", api_key="test-api-key")
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
            headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            body = json.loads(response.read().decode())
        self.assertEqual(body["choices"][0]["message"]["content"], "Hello")

    def test_translation_success_response_remains_compatible(self):
        request = urllib.request.Request(self.url + "/translate",
            data=json.dumps({"text": "你好"}).encode(),
            headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request) as response:
            self.assertEqual(json.loads(response.read()), {
                "translation": "Hello", "model": "hy-mt2-7b:q6_k", "quality_issues": [], "metrics": None,
            })

    def test_json_error_codes_preserve_legacy_status_and_type(self):
        cases = [
            (TranslationRequestError("busy message", "translation_busy"), 400, "invalid_request_error", "translation_busy"),
            (ModelNotReadyError("not enabled"), 503, "llama_runtime_error", "model_not_ready"),
        ]
        for route in ("/translate", "/v1/chat/completions"):
            for error, status, error_type, code in cases:
                with self.subTest(route=route, code=code):
                    self.httpd.app.engine.translate.side_effect = error
                    request = urllib.request.Request(self.url + route,
                        data=json.dumps({"text": "你好"}).encode(),
                        headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"}, method="POST")
                    with self.assertRaises(urllib.error.HTTPError) as raised:
                        urllib.request.urlopen(request)
                    with raised.exception as response:
                        self.assertEqual(response.code, status)
                        self.assertEqual(json.loads(response.read()), {
                            "error": {"message": str(error), "type": error_type, "code": code},
                        })

    def test_stream_readiness_error_is_coded_without_loading(self):
        manager = self.httpd.app.engine.manager
        manager.require_ready_server = Mock(side_effect=ModelNotReadyError("not enabled"))
        manager.ensure_server = Mock()
        request = urllib.request.Request(self.url + "/translate/stream",
            data=json.dumps({"text": "你好", "require_ready": True}).encode(),
            headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.status, 200)
            events = [json.loads(line[6:]) for line in response.read().decode().splitlines() if line.startswith("data: ")]
        self.assertEqual(events, [{"type": "error", "message": "not enabled", "code": "model_not_ready"}])
        manager.ensure_server.assert_not_called()

    def test_stream_busy_error_does_not_cancel_existing_job(self):
        engine = self.httpd.app.engine
        active = engine.translate_stream({"text": "你好", "target_language": "English"})
        plan = next(active)
        try:
            request = urllib.request.Request(self.url + "/translate/stream",
                data=json.dumps({"text": "新请求", "require_ready": True}).encode(),
                headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(request) as response:
                events = [json.loads(line[6:]) for line in response.read().decode().splitlines() if line.startswith("data: ")]
            self.assertEqual(events[0]["type"], "error")
            self.assertEqual(events[0]["code"], "translation_busy")
            self.assertFalse(engine._jobs[plan["job_id"]].cancel.is_set())
            self.assertEqual(engine._active_job.id, plan["job_id"])
        finally:
            active.close()

    def test_telemetry_endpoint(self):
        sample = {"timestamp": 1, "gpus": [{"id": "gpu", "power_w": None}], "message": ""}
        self.httpd.app.telemetry.snapshot = Mock(return_value=sample)
        with urllib.request.urlopen(urllib.request.Request(self.url + "/admin/telemetry", headers={"Authorization": "Bearer test-admin-secret"})) as response:
            result = json.loads(response.read())
            self.assertEqual({key: result[key] for key in sample}, sample)
            self.assertIsNone(result["inference"]["active"])
            self.assertEqual(result["inference"]["summary"]["calls"], 0)
            self.assertEqual(result["inference"]["architecture"]["model"], self.httpd.app.settings.model_name)

    def test_translation_cancel_endpoint(self):
        engine = self.httpd.app.engine
        engine.cancel_translation = Mock()
        request = urllib.request.Request(self.url + "/translate/cancel",
            data=json.dumps({"job_id": "job-1"}).encode(),
            headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request) as response:
            self.assertEqual(json.loads(response.read())["status"], "cancelling")
        engine.cancel_translation.assert_called_once_with("job-1", self.httpd.app.identity.authorize("Bearer test-admin-secret", admin=True))

    def test_download_cancel_endpoint(self):
        request = urllib.request.Request(
            self.url + "/admin/download/cancel",
            data=b"",
            headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            body = json.loads(response.read().decode())
        self.assertEqual(body["status"], "cancelling")
    def test_model_download_stream_reports_progress(self):
        request = urllib.request.Request(
            self.url + "/admin/download",
            data=json.dumps({"model": "hy-mt2-7b:q6_k"}).encode(),
            headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json", "Accept": "text/event-stream"},
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

        with urllib.request.urlopen(urllib.request.Request(self.url + "/admin/environment?model=hy-mt2-7b%3Aq8_0", headers={"Authorization": "Bearer test-admin-secret"})) as response:
            body = json.loads(response.read().decode())

        self.assertEqual(body["model"], "hy-mt2-7b:q8_0")
        inspect.assert_called_once_with("hy-mt2-7b:q8_0")
if __name__ == "__main__":
    unittest.main()
