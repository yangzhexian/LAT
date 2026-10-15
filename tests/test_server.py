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
            (TranslationRequestError("queue timed out", "translation_queue_timeout"), 429, "rate_limit_error", "translation_queue_timeout"),
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

    def test_stream_queue_full_does_not_cancel_existing_job(self):
        engine = self.httpd.app.engine
        engine.scheduler.max_pending = 0
        engine._translate_segment_stream = Mock(return_value=iter([{"type": "progress", "translation": "Hello"}]))
        active = engine.translate_stream({"text": "你好", "target_language": "English"})
        plan = next(active)
        next(active)
        try:
            request = urllib.request.Request(self.url + "/translate/stream",
                data=json.dumps({"text": "新请求"}).encode(),
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

    def test_gpu_incremental_endpoint_and_session_reset_without_heavy_payloads(self):
        app = self.httpd.app
        app.engine.inference.snapshot = Mock(side_effect=AssertionError("GPU route must not read inference"))
        app.architecture.snapshot = Mock(side_effect=AssertionError("GPU route must not read architecture"))
        import time
        now = time.time()
        for stamp in (now - 1, now):
            app.telemetry._record({"timestamp": stamp, "gpus": [], "message": ""})
        session = app.telemetry.session_id
        for query, expected_count, reset in ((f"since={now - 1}&session_id={session}", 1, False),
                                               (f"since={now}&session_id={session}", 0, False),
                                               (f"since={now}&session_id=old-session", 2, True),
                                               (f"since={now}", 2, True), ("", 2, False)):
            with self.subTest(query=query):
                request = urllib.request.Request(self.url + "/admin/telemetry/gpu?" + query,
                    headers={"Authorization": "Bearer test-admin-secret"})
                with urllib.request.urlopen(request) as response:
                    result = json.loads(response.read())
                self.assertEqual(len(result["samples"]), expected_count)
                self.assertEqual(result["reset"], reset)
                self.assertEqual(result["cursor"], now)
                self.assertEqual(result["session_id"], session)
                self.assertNotIn("inference", result)
                self.assertNotIn("architecture", result)

    def test_gpu_endpoint_rejects_invalid_cursor_even_with_mismatched_session(self):
        for query in ("since=nan", "since=inf", "since=-1", "since=", "since=abc", "since=1&since=2", "session_id=a&session_id=b"):
            with self.subTest(query=query):
                request = urllib.request.Request(self.url + "/admin/telemetry/gpu?" + query,
                    headers={"Authorization": "Bearer test-admin-secret"})
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    urllib.request.urlopen(request)
                with raised.exception as response:
                    self.assertEqual(response.code, 400)
                    self.assertEqual(json.loads(response.read())["error"]["code"], "invalid_request")

    def test_split_telemetry_routes_require_admin_credential(self):
        for route in ("/admin/telemetry/gpu?since=0", "/admin/telemetry/inference", "/admin/architecture"):
            for token in ("test-api-key", "bad-token"):
                with self.subTest(route=route, token=token):
                    request = urllib.request.Request(self.url + route, headers={"Authorization": "Bearer " + token})
                    with self.assertRaises(urllib.error.HTTPError) as raised:
                        urllib.request.urlopen(request)
                    with raised.exception as response:
                        self.assertEqual(response.code, 401)

    def test_inference_endpoint_contains_no_gpu_or_architecture_payload(self):
        app = self.httpd.app
        snapshot = {"active": None, "recent": [], "summary": {"calls": 2}}
        app.engine.inference.snapshot = Mock(return_value=snapshot)
        app.telemetry.snapshot = Mock(side_effect=AssertionError("inference must not read GPU"))
        app.architecture.snapshot = Mock(side_effect=AssertionError("inference must not read architecture"))
        request = urllib.request.Request(self.url + "/admin/telemetry/inference", headers={"Authorization": "Bearer test-admin-secret"})
        with urllib.request.urlopen(request) as response:
            self.assertEqual(json.loads(response.read()), snapshot)

    def test_architecture_conditional_get_and_cors_avoid_copy_and_serialization(self):
        app = self.httpd.app
        app.telemetry.snapshot = Mock(side_effect=AssertionError("architecture must not read GPU"))
        app.engine.inference.snapshot = Mock(side_effect=AssertionError("architecture must not read inference"))
        headers = {"Authorization": "Bearer test-admin-secret", "Origin": "http://tauri.localhost"}
        with patch('local_translator.model_metadata.read_architecture', return_value={"model": "fixture", "block_tensors": []}):
            request = urllib.request.Request(self.url + "/admin/architecture", headers=headers)
            with urllib.request.urlopen(request) as response:
                etag = response.headers['ETag']
                self.assertEqual(json.loads(response.read()), {"architecture": {"model": "fixture", "block_tensors": []}})
                self.assertIn("ETag", response.headers['Access-Control-Expose-Headers'])
                self.assertIn("If-None-Match", response.headers['Access-Control-Allow-Headers'])
            with patch('local_translator.model_metadata.copy.deepcopy', side_effect=AssertionError("must not copy")), patch('local_translator.model_metadata.json.dumps', side_effect=AssertionError("must not serialize")):
                request = urllib.request.Request(self.url + "/admin/architecture", headers={**headers, "If-None-Match": etag})
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    urllib.request.urlopen(request)
                with raised.exception as response:
                    self.assertEqual(response.code, 304)
                    self.assertEqual(response.read(), b'')
                    self.assertEqual(response.headers['ETag'], etag)
                    self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'http://tauri.localhost')
        request = urllib.request.Request(self.url + '/admin/architecture', headers={"Origin": "http://tauri.localhost"}, method='OPTIONS')
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.status, 204)
            self.assertIn('If-None-Match', response.headers['Access-Control-Allow-Headers'])

    def test_translation_source_is_authorized_and_internal_fields_cannot_be_spoofed(self):
        for route in ('/translate', '/v1/chat/completions'):
            for token, source, expected in (('test-admin-secret', 'selection', 'selection'),
                                             ('test-admin-secret', 'workspace', 'workspace'),
                                             ('test-api-key', 'selection', 'api')):
                with self.subTest(route=route, token=token, source=source):
                    body = {"text": "你好", "request_source": source, "_request_source": "selection", "_owner": "forged", "_cancel": True}
                    request = urllib.request.Request(self.url + route, data=json.dumps(body).encode(),
                        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method='POST')
                    with urllib.request.urlopen(request) as response:
                        self.assertEqual(response.status, 200)
                    sent = self.httpd.app.engine.translate.call_args.args[0]
                    self.assertEqual(sent['_request_source'], expected)
                    self.assertNotIn('request_source', sent)
                    self.assertEqual(sent['_owner'], self.httpd.app.identity.authorize('Bearer ' + token, admin=False))
                    self.assertIsInstance(sent['_cancel'], threading.Event)
        request = urllib.request.Request(self.url + '/translate', data=json.dumps({"text": "你好", "_request_source": "selection"}).encode(),
            headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"}, method='POST')
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(self.httpd.app.engine.translate.call_args.args[0]['_request_source'], 'workspace')

    def test_invalid_admin_public_source_is_rejected(self):
        request = urllib.request.Request(self.url + '/translate', data=json.dumps({"text": "你好", "request_source": "unknown"}).encode(),
            headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"}, method='POST')
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request)
        with raised.exception as response:
            self.assertEqual(response.code, 400)
        self.httpd.app.engine.translate.assert_not_called()

    def test_sse_queue_timeout_retains_error_code_and_sanitized_source(self):
        for route, openai in (('/translate/stream', False), ('/v1/chat/completions', True)):
            self.httpd.app.engine.translate_stream = Mock(side_effect=TranslationRequestError('queue timed out', 'translation_queue_timeout'))
            body = {"text": "你好", "stream": True, "request_source": "selection", "_request_source": "selection"}
            request = urllib.request.Request(self.url + route, data=json.dumps(body).encode(),
                headers={"Authorization": "Bearer test-api-key", "Content-Type": "application/json"}, method='POST')
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
                events = [json.loads(line[6:]) for line in response.read().decode().splitlines() if line.startswith('data: ') and line != 'data: [DONE]']
            error = events[-1]['error'] if openai else events[-1]
            self.assertEqual(error['code'], 'translation_queue_timeout')
            self.assertEqual(self.httpd.app.engine.translate_stream.call_args.args[0]['_request_source'], 'api')

    def test_cancelling_queued_request_leaves_active_job_running(self):
        engine = self.httpd.app.engine
        engine._translate_segment_stream = Mock(return_value=iter([{"type": "progress", "translation": "Hello"}]))
        active = engine.translate_stream({"text": "你好", "target_language": "English"})
        plan = next(active)
        next(active)
        try:
            request = urllib.request.Request(self.url + '/translate/stream', data=json.dumps({"text": "queued request", "target_language": "English"}).encode(),
                headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"}, method='POST')
            with urllib.request.urlopen(request, timeout=5) as response:
                queued_id = None
                while True:
                    line = response.readline().decode()
                    self.assertTrue(line, 'queued stream ended before a waiting event')
                    if line.startswith('data: '):
                        event = json.loads(line[6:])
                        queued_id = event.get('job_id', queued_id)
                        if event['type'] == 'waiting':
                            break
                cancel = urllib.request.Request(self.url + '/translate/cancel', data=json.dumps({"job_id": queued_id}).encode(),
                    headers={"Authorization": "Bearer test-admin-secret", "Content-Type": "application/json"}, method='POST')
                with urllib.request.urlopen(cancel) as cancelled:
                    self.assertEqual(cancelled.status, 200)
                events = [json.loads(line[6:]) for line in response.read().decode().splitlines() if line.startswith('data: ')]
                self.assertTrue(any(event['type'] == 'cancelled' for event in events))
            self.assertFalse(engine._jobs[plan['job_id']].cancel.is_set())
            self.assertEqual(engine._active_job.id, plan['job_id'])
            self.assertEqual(engine._translate_segment_stream.call_count, 1)
        finally:
            active.close()

if __name__ == "__main__":
    unittest.main()
