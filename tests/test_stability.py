import json
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

from local_translator.config import Settings
from local_translator.engine import TranslationEngine
from local_translator.errors import LlamaError, ModelBusyError
from local_translator.jobs import TranslationCancelled
from local_translator.runtime import LlamaCppProcessManager
from local_translator.server import App, RequestHandler
from local_translator.stream_transport import stream_lines


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.settings = Settings(runtime_root=self.directory.name)
        self.manager = LlamaCppProcessManager(self.settings)
        self.manager._server_executable = lambda: Path(self.directory.name) / "llama-server.exe"
        self.manager._verified = Mock(return_value=True)
        self.processes = []
        def spawn(*_args, **_kwargs):
            process = Mock()
            process.poll.return_value = None
            self.processes.append(process)
            time.sleep(.02)
            return process
        self.spawn_patch = patch("local_translator.runtime.subprocess.Popen", side_effect=spawn)
        self.spawn = self.spawn_patch.start()
        self.health_patch = patch("local_translator.runtime.LlamaServerClient.is_ready", return_value=True)
        self.health = self.health_patch.start()

    def tearDown(self):
        self.manager.shutdown()
        self.health_patch.stop()
        self.spawn_patch.stop()
        self.directory.cleanup()

    def test_concurrent_start_is_single_flight(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            clients = list(pool.map(lambda _: self.manager.ensure_server(), range(8)))
        self.assertEqual(self.spawn.call_count, 1)
        self.assertTrue(all(client is clients[0] for client in clients))
        self.assertEqual(self.manager.status()["lifecycle"], "ready")

    def test_explicit_model_load_replaces_old_process_and_identity(self):
        first = self.manager.ensure_server()
        first_id = self.manager.runtime_instance_id
        second = self.manager.load_model("hy-mt2-1.8b:q8_0")
        self.assertNotEqual(first.resolve_model(), second.resolve_model())
        self.processes[0].terminate.assert_called_once()
        self.assertEqual(second.resolve_model(), self.settings.model_name)
        self.assertNotEqual(first_id, self.manager.runtime_instance_id)

    def test_failed_load_is_consistent_and_can_retry(self):
        self.manager._verified.return_value = False
        with self.assertRaises(LlamaError):
            self.manager.ensure_server()
        self.assertEqual(self.manager.lifecycle, "failed")
        self.assertIsNone(self.manager.owned_process)
        self.manager._verified.return_value = True
        self.manager.ensure_server()
        self.assertEqual(self.manager.lifecycle, "ready")

    def test_shutdown_interrupts_loading_without_waiting_for_startup_deadline(self):
        checking = threading.Event()
        self.health.side_effect = lambda: checking.set() or False
        with ThreadPoolExecutor() as pool:
            start = pool.submit(self.manager.ensure_server)
            self.assertTrue(checking.wait(2))
            self.assertEqual(self.manager.status()["lifecycle"], "loading")
            before = time.monotonic()
            self.manager.shutdown()
            with self.assertRaises(LlamaError):
                start.result(timeout=2)
            self.assertLess(time.monotonic() - before, 2)
        self.assertIsNone(self.manager.owned_process)
        self.assertEqual(self.manager.lifecycle, "unloaded")

    def test_management_rejects_mutation_during_document(self):
        engine = TranslationEngine(self.settings, self.manager)
        stream = engine.translate_stream({"text": "hello", "target_language": "Chinese"})
        next(stream)
        try:
            with self.assertRaises(ModelBusyError), engine.management():
                pass
        finally:
            stream.close()
        with engine.management():
            pass


class InterruptibleTransportTests(unittest.TestCase):
    def run_silent(self, *, headers, cancel, timeout=False):
        reached, release = threading.Event(), threading.Event()
        class Silent(BaseHTTPRequestHandler):
            def log_message(self, *_args): pass
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                if headers:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.flush()
                reached.set()
                release.wait(3)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Silent)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        settings = Settings(first_response_timeout_seconds=.15 if timeout else 120)
        try:
            with ThreadPoolExecutor() as pool:
                future = pool.submit(lambda: list(stream_lines(f"http://127.0.0.1:{server.server_port}/stream", b"{}", settings, cancel)))
                self.assertTrue(reached.wait(2))
                before = time.monotonic()
                if not timeout:
                    cancel.set()
                with self.assertRaises(LlamaError if timeout else TranslationCancelled):
                    future.result(timeout=2)
                self.assertLess(time.monotonic() - before, 1.5)
        finally:
            release.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_cancel_while_waiting_for_headers(self):
        self.run_silent(headers=False, cancel=threading.Event())

    def test_cancel_while_waiting_for_first_sse_line(self):
        self.run_silent(headers=True, cancel=threading.Event())

    def test_silent_model_has_first_response_deadline(self):
        self.run_silent(headers=True, cancel=threading.Event(), timeout=True)

    def test_chunked_http_keeps_split_utf8_and_sse_frames(self):
        from local_translator.llama_client import LlamaServerClient
        payload = ('data: ' + json.dumps({"choices": [{"delta": {"content": "你好"}}]}, ensure_ascii=False)
                   + '\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n').encode()
        class Chunked(BaseHTTPRequestHandler):
            def log_message(self, *_args): pass
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200)
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                for byte in payload:
                    self.wfile.write(b"1\r\n" + bytes([byte]) + b"\r\n")
                try:
                    self.wfile.write(b"0\r\n\r\n")
                except OSError:
                    pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Chunked)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = LlamaServerClient(f"http://127.0.0.1:{server.server_port}", Settings())
            events = list(client.chat_stream("model", [], {}))
            self.assertEqual(events[0]["message"]["content"], "你好")
            self.assertTrue(events[-1]["done"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_idle_and_total_deadlines_after_response_begins(self):
        for continuous in (False, True):
            with self.subTest(continuous=continuous):
                release = threading.Event()
                class Partial(BaseHTTPRequestHandler):
                    def log_message(self, *_args): pass
                    def do_POST(self):
                        self.rfile.read(int(self.headers["Content-Length"]))
                        self.send_response(200)
                        self.end_headers()
                        try:
                            self.wfile.write(b"data: {}\n\n")
                            self.wfile.flush()
                            if continuous:
                                while not release.wait(.02):
                                    self.wfile.write(b": ping\n\n")
                                    self.wfile.flush()
                            else:
                                release.wait(2)
                        except OSError:
                            pass
                server = ThreadingHTTPServer(("127.0.0.1", 0), Partial)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                settings = Settings(request_timeout_seconds=.25 if continuous else 10, stream_idle_timeout_seconds=.15)
                try:
                    with self.assertRaisesRegex(LlamaError, "总时限" if continuous else "没有数据"):
                        list(stream_lines(f"http://127.0.0.1:{server.server_port}/stream", b"{}", settings))
                finally:
                    release.set()
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=2)


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), RequestHandler)
        self.server.app = App(Settings(admin_token="admin-test", api_key="client-test"))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.release = threading.Event()

    def tearDown(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, route, *, token=None, body=None, origin=None):
        headers = {"Content-Type": "application/json"}
        if token: headers["Authorization"] = "Bearer " + token
        if origin: headers["Origin"] = origin
        return urllib.request.urlopen(urllib.request.Request(self.url + route,
            data=json.dumps(body).encode() if body is not None else None, headers=headers), timeout=3)

    def test_health_has_version_and_instance_but_never_credentials(self):
        with self.request("/health") as response:
            health = json.load(response)
        self.assertEqual(health["protocol_version"], 2)
        self.assertTrue(health["instance_id"])
        self.assertNotIn("admin-test", json.dumps(health))

    def test_management_requires_admin_and_allowed_browser_origin(self):
        for token, origin, status in ((None, None, 401), ("client-test", None, 401), ("admin-test", "https://example.com", 403)):
            with self.subTest(token=token, origin=origin), self.assertRaises(urllib.error.HTTPError) as caught:
                self.request("/admin/unload", token=token, body={}, origin=origin)
            self.assertEqual(caught.exception.code, status)
            caught.exception.close()
        self.server.app.engine.manager.shutdown = Mock()
        with self.request("/admin/unload", token="admin-test", body={}, origin="http://tauri.localhost") as response:
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://tauri.localhost")
        self.server.app.engine.manager.shutdown.assert_called_once()

    def test_openai_stream_delivers_validated_segment_before_document_completes(self):
        def stream(body):
            yield {"type": "plan", "translation": ""}
            yield {"type": "segment_complete", "translation": "first "}
            self.release.wait(2)
            yield {"type": "segment_complete", "translation": "second"}
            yield {"type": "complete", "model": "model", "translation": "first second",
                   "metrics": {"prompt_tokens": 10, "generated_tokens": 5, "total_tokens": 15}}
        self.server.app.engine.translate_stream = stream
        with self.request("/v1/chat/completions", token="client-test", body={"stream": True, "stream_options": {"include_usage": True}}) as response:
            first = response.readline()
            while b'first ' not in first:
                first = response.readline()
                self.assertTrue(first)
            self.assertFalse(self.release.is_set())
            self.release.set()
            remaining = response.read().decode()
        self.assertIn('"total_tokens": 15', remaining)
        self.assertIn('[DONE]', remaining)

    def test_disconnect_cancels_only_the_stream_transport(self):
        stopped = threading.Event()
        def stream(body):
            try:
                yield {"type": "plan", "job_id": "owned"}
                body["_cancel"].wait(3)
            finally:
                stopped.set()
        self.server.app.engine.translate_stream = stream
        response = self.request("/translate/stream", token="admin-test", body={})
        self.assertIn(b'plan', response.readline())
        response.close()
        self.assertTrue(stopped.wait(2))

    def test_unknown_usage_is_not_zero_usage(self):
        self.server.app.engine.translate = Mock(return_value=type("Result", (), {"text": "ok", "model": "model", "metrics": None})())
        with self.request("/v1/chat/completions", token="client-test", body={}) as response:
            self.assertNotIn("usage", json.load(response))

    def test_other_credentials_cannot_cancel_checkpoint(self):
        engine = self.server.app.engine
        stream = engine.translate_stream({"text": "hello", "target_language": "Chinese", "_owner": "different"})
        plan = next(stream)
        try:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.request("/translate/cancel", token="client-test", body={"job_id": plan["job_id"]})
            caught.exception.close()
            self.assertFalse(engine._active_job.cancel.is_set())
        finally:
            stream.close()

    def test_nonstream_disconnect_interrupts_generation(self):
        reached, stopped = threading.Event(), threading.Event()
        def translate(body):
            reached.set()
            body["_cancel"].wait(3)
            stopped.set()
            raise TranslationCancelled()
        self.server.app.engine.translate = translate
        connection = socket.create_connection(("127.0.0.1", self.server.server_port))
        connection.sendall(b"POST /translate HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer admin-test\r\nContent-Length: 2\r\n\r\n{}")
        self.assertTrue(reached.wait(1))
        connection.close()
        self.assertTrue(stopped.wait(2))

    def test_cli_management_includes_session_credentials(self):
        from local_translator.cli import _gateway_request
        settings = Settings(port=self.server.server_port, admin_token="admin-test")
        result = _gateway_request(settings, "GET", "/admin/status")
        self.assertEqual(result["backend"], "llama.cpp")

    def test_explicit_extension_origin_and_invalid_timeout_settings(self):
        self.server.app.settings.allowed_origins = ["chrome-extension://test-extension"]
        with self.request("/v1/models", token="client-test", origin="chrome-extension://test-extension") as response:
            self.assertEqual(response.status, 200)
        with self.assertRaises(ValueError):
            Settings(stream_idle_timeout_seconds=float("nan")).validate()
        with self.assertRaises(ValueError):
            Settings(admin_token="key\r\ninjected").validate()


class ShutdownAndUsageTests(unittest.TestCase):
    def test_shutdown_rejects_management_and_inflight_job_admission(self):
        from local_translator.engine import TranslationEngine, TranslationRequestError
        engine = TranslationEngine(Settings())
        engine.begin_shutdown()
        with self.assertRaises(ModelBusyError):
            with engine.management():
                self.fail("management must not start during shutdown")
        with self.assertRaises(TranslationRequestError):
            list(engine.translate_stream({"text": "hello", "target_language": "Chinese"}))
        engine = TranslationEngine(Settings())
        original = engine._get_job
        def shutdown_during_admission(body):
            job = original(body)
            engine.begin_shutdown()
            return job
        engine._get_job = shutdown_during_admission
        engine.manager.ensure_server = Mock(side_effect=AssertionError("must not load a model"))
        events = list(engine.translate_stream({"text": "hello", "target_language": "Chinese"}))
        self.assertEqual(events[-1]["type"], "cancelled")
        engine.manager.ensure_server.assert_not_called()

    def test_resumed_disconnect_does_not_invent_usage_for_failed_attempt(self):
        from local_translator.engine import TranslationEngine, TranslationOutputError
        engine = TranslationEngine(Settings())
        fail = True
        def segment(body, _cancel):
            if body["text"] == "two" and fail:
                raise LlamaError("connection lost before final usage")
            yield {"type": "usage", "metrics": {"prompt_tokens": 3, "generated_tokens": 2, "eval_duration_ns": 20}}
            yield {"type": "complete", "translation": body["text"], "quality_issues": []}
        engine._translate_segment_stream = segment
        body = {"text": "one two", "target_language": "Chinese"}
        with patch("local_translator.engine.split_source", return_value=["one", "two"]):
            stream = engine.translate_stream(body)
            plan = next(stream)
            with self.assertRaises(TranslationOutputError):
                list(stream)
            fail = False
            complete = list(engine.translate_stream(dict(body, job_id=plan["job_id"])))[-1]
        self.assertEqual(complete["translation"], "onetwo")
        self.assertIsNone(complete["metrics"]["prompt_tokens"])
        self.assertIsNone(complete["metrics"]["generated_tokens"])
        self.assertIsNone(complete["metrics"]["total_tokens"])
