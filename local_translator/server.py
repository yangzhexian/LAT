from __future__ import annotations

import json
import urllib.parse
import logging
import threading
import time
import uuid
import queue
import select
import socket
from contextlib import closing
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .catalog import MODEL_CATALOG, MODEL_ID
from .config import Settings
from .environment import inspect_download_environment
from .engine import TranslationEngine, TranslationOutputError, TranslationRequestError
from .errors import DownloadCancelled, LlamaError, ModelBusyError
from .version import __version__
from .telemetry import GpuTelemetry
from .model_metadata import ArchitectureMetadataCache
from .protocol import GatewayIdentity, PROTOCOL_VERSION, DESKTOP_ORIGINS


LOGGER = logging.getLogger(__name__)

HTML_PAGE = """<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LAT</title>
<style>body{font-family:system-ui;margin:32px;background:#111827;color:#e5e7eb}main{max-width:1100px;margin:auto}.grid{display:flex;gap:16px}.panel{flex:1}textarea,input{width:100%;box-sizing:border-box;background:#1f2937;color:#fff;border:1px solid #374151;border-radius:8px;padding:12px}textarea{min-height:260px}button{border:0;border-radius:7px;padding:10px 15px;background:#2563eb;color:#fff}button.secondary{background:#374151}.toolbar{display:flex;gap:12px;align-items:end;margin:16px 0}.muted{color:#9ca3af}</style>
</head><body><main><h1>LAT · Local AI Translator</h1><p class="muted">使用本机 llama.cpp 运行 Hy-MT2 不发送到云端</p>
<div class="toolbar"><label>网关管理密钥<input id="gatewayToken" type="password" autocomplete="off" placeholder="LAT_ADMIN_TOKEN"></label><label>目标语言<input id="target" value="English"></label><button class="secondary" id="statusButton">刷新状态</button><button class="secondary" id="unloadButton">关闭模型</button></div>
<div class="grid"><section class="panel"><label>原文<textarea id="source"></textarea></label></section><section class="panel"><label>译文<textarea id="result" readonly></textarea></label></section></div>
<div class="toolbar"><button id="translateButton">翻译</button><span id="status"></span></div><div id="message" class="muted"></div></main>
<script>
const $=id=>document.getElementById(id);
const call=(url,init={})=>fetch(url,{...init,headers:{...init.headers,Authorization:'Bearer '+$('gatewayToken').value}});
async function status(){try{const r=await call('/admin/status');const d=await r.json();if(!r.ok)throw Error(d.error?.message||'请求失败');$('status').textContent=d.ready?'llama.cpp · 已启用':'模型未启用'}catch(e){$('status').textContent=e.message}}
async function unload(){try{const r=await call('/admin/unload',{method:'POST'});const d=await r.json();if(!r.ok)throw Error(d.error?.message||'请求失败');$('message').textContent='模型已关闭';await status()}catch(e){$('message').textContent='关闭失败：'+e.message}};
async function translate(){const text=$('source').value.trim();if(!text)return;$('translateButton').disabled=true;try{const r=await call('/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,target_language:$('target').value})});const d=await r.json();if(!r.ok)throw Error(d.error?.message||'请求失败');$('result').value=d.translation;$('message').textContent='完成'}catch(e){$('message').textContent='翻译失败：'+e.message}finally{$('translateButton').disabled=false}}
$('translateButton').onclick=translate;$('unloadButton').onclick=unload;$('statusButton').onclick=status;status();
</script></body></html>"""


class App:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.engine = TranslationEngine(settings)
        self.telemetry = GpuTelemetry()
        self.architecture = ArchitectureMetadataCache()
        self.identity = GatewayIdentity(settings)
        self.stopping = threading.Event()
        self.httpd: ThreadingHTTPServer | None = None

    def stop(self) -> None:
        self.stopping.set()
        self.engine.begin_shutdown()
        try:
            self.telemetry.stop()
            self.engine.manager.shutdown()
        finally:
            if self.httpd is not None:
                self.httpd.shutdown()


class RequestHandler(BaseHTTPRequestHandler):
    server_version = f"LATLocalTranslator/{__version__}"

    @property
    def app(self) -> App:
        return self.server.app  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.address_string(), format % args)

    def _headers(self, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_header("Content-Type", content_type)
        origin = self.headers.get("Origin")
        if origin and self._origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _origin_allowed(self, origin: str) -> bool:
        return origin in DESKTOP_ORIGINS or origin in self.app.settings.allowed_origins or origin in {
            f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"}

    def _authorize(self, *, preflight: bool = False) -> bool:
        origin = self.headers.get("Origin")
        if origin and not self._origin_allowed(origin):
            self._json(403, {"error": {"message": "不允许的请求来源", "code": "origin_denied"}})
            return False
        if preflight or (self.command == "GET" and self.path in ("/health", "/v1/health", "/")):
            return True
        owner = self.app.identity.authorize(self.headers.get("Authorization", ""), admin=self.path.startswith("/admin/"))
        if owner is None:
            self._json(401, {"error": {"message": "网关会话密钥无效或未配置", "code": "unauthorized"}})
            return False
        self.request_owner = owner
        if self.app.stopping.is_set():
            self._json(503, {"error": {"message": "网关正在退出", "code": "gateway_stopping"}})
            return False
        return True

    def _json(self, status: int, value: dict[str, Any]) -> None:
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._headers()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 2_000_000:
            raise TranslationRequestError("请求体为空或超过 2 MB 限制")
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise TranslationRequestError("请求体不是有效 JSON") from error
        if not isinstance(value, dict):
            raise TranslationRequestError("请求体必须是 JSON 对象")
        return value

    def _read_optional_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        return {} if length == 0 else self._read_json()

    def do_OPTIONS(self) -> None:
        if not self._authorize(preflight=True):
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self._headers()
        self.end_headers()

    def do_GET(self) -> None:
        if not self._authorize():
            return
        try:
            if self.path == "/":
                data = HTML_PAGE.encode("utf-8")
                self.send_response(200)
                self._headers("text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if self.path in {"/health", "/v1/health"}:
                self._json(200, {"status": "ok", "service": "lat-local-translator", "version": __version__,
                                 "protocol_version": PROTOCOL_VERSION, "instance_id": self.app.identity.instance_id})
                return
            if self.path == "/admin/telemetry":
                inference = self.app.engine.inference.snapshot()
                inference["architecture"] = self.app.architecture.snapshot(
                    self.app.settings.resolved_model_path, self.app.settings.model_name)
                self._json(200, {**self.app.telemetry.snapshot(), "inference": inference})
                return
            if self.path == "/admin/status":
                self._json(200, {**self.app.engine.manager.status(), "max_input_chars": self.app.settings.max_input_chars})
                return
            if self.path.startswith("/admin/environment") or self.path == "/admin/runtime/status":
                if urllib.parse.urlparse(self.path).path == "/admin/environment":
                    query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                    requested_model = query.get("model", [MODEL_ID])[0]
                    value = inspect_download_environment(requested_model)
                else:
                    value = self.app.engine.manager.status()
                self._json(200, value)
                return
            if self.path == "/v1/models":
                status = self.app.engine.manager.status()
                self._json(200, {"object": "list", "data": [{"id": status["resolved_model"], "object": "model", "owned_by": "local-llama.cpp"}]})
                return
            self._json(404, {"error": {"message": "not found", "type": "not_found"}})
        except Exception as error:
            self._json(503, {"error": {"message": str(error), "type": "service_unavailable"}})

    def do_POST(self) -> None:
        if not self._authorize():
            return
        try:
            if self.path == "/admin/telemetry":
                try:
                    self.app.telemetry.configure(self._read_json().get("interval"))
                except ValueError as error:
                    raise TranslationRequestError(str(error)) from error
                self._json(200, {"status": "configured"})
                return
            if self.path == "/translate/cancel":
                job_id = self._read_json().get("job_id")
                if not isinstance(job_id, str) or not job_id:
                    raise TranslationRequestError("job_id 不能为空")
                self.app.engine.cancel_translation(job_id, self.request_owner)
                self._json(200, {"status": "cancelling", "job_id": job_id})
                return
            if self.path == "/admin/directory":
                body = self._read_json()
                root_dir = body.get("root_dir")
                if not isinstance(root_dir, str) or not root_dir.strip():
                    raise TranslationRequestError("数据目录不能为空")
                with self.app.engine.management():
                    status = self.app.engine.manager.set_data_root(root_dir)
                self._json(200, {"status": "configured", "root_dir": str(status["runtime"]["root_dir"])})
                return
            if self.path in {"/admin/start", "/admin/engine/start"}:
                with self.app.engine.management():
                    client = self.app.engine.manager.ensure_server()
                self._json(200, {"status": "started", "backend": "llama.cpp", "model": client.resolve_model()})
                return
            if self.path in {"/admin/load", "/admin/engine/load"}:
                body = self._read_optional_json()
                requested_model = body.get("model", self.app.engine.manager.settings.model_name)
                if not isinstance(requested_model, str) or requested_model not in MODEL_CATALOG:
                    raise TranslationRequestError("不支持的 Hy-MT2 模型版本")
                with self.app.engine.management():
                    client = self.app.engine.manager.load_model(requested_model)
                self._json(200, {"status": "loaded", "model": client.resolve_model()})
                return
            if self.path in {"/admin/unload", "/admin/engine/stop"}:
                with self.app.engine.management():
                    self.app.engine.manager.shutdown()
                self._json(200, {"status": "unloaded", "backend": "llama.cpp"})
                return
            if self.path == "/admin/shutdown":
                self._json(200, {"status": "shutting_down"})
                threading.Thread(target=self.app.stop, daemon=True).start()
                return
            if self.path == "/admin/download/cancel":
                self.app.engine.manager.cancel_download()
                self._json(200, {"status": "cancelling"})
                return
            if self.path in {"/admin/download", "/admin/model/download"}:
                self._stream_download(self._read_optional_json())
                return
            if self.path not in {"/translate", "/translate/stream", "/v1/chat/completions"}:
                self._json(404, {"error": {"message": "not found", "type": "not_found"}})
                return

            body = self._read_json()
            body["_owner"] = self.request_owner
            body.pop("_cancel", None)
            if self.path == "/translate/stream":
                self._stream_translation(body)
                return
            if self.path == "/v1/chat/completions" and body.get("stream") is True:
                self._stream_translation(body, openai=True)
                return
            result = self._translate_nonstream(body)
            if self.path == "/translate":
                self._json(200, {"translation": result.text, "model": result.model, "quality_issues": result.issues, "metrics": result.metrics})
                return
            self._chat_completion(body, result.text, result.model, result.metrics)
        except (BrokenPipeError, ConnectionResetError):
            return
        except TranslationRequestError as error:
            self._json(400, {"error": {"message": str(error), "type": "invalid_request_error", "code": error.code}})
        except TranslationOutputError as error:
            self._json(502, {"error": {"message": str(error), "type": "model_output_error", "code": error.code}})
        except ModelBusyError as error:
            self._json(409, {"error": {"message": str(error), "type": "conflict", "code": error.code}})
        except LlamaError as error:
            self._json(503, {"error": {"message": str(error), "type": "llama_runtime_error", "code": error.code}})
        except Exception as error:
            LOGGER.exception("request failed")
            self._json(500, {"error": {"message": str(error), "type": "internal_error"}})

    def _stream_download(self, body: dict[str, Any]) -> None:
        requested_model = body.get("model", MODEL_ID)
        if not isinstance(requested_model, str) or requested_model not in MODEL_CATALOG:
            raise TranslationRequestError("不支持的 Hy-MT2 模型版本")
        self.send_response(200)
        self._headers("text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def emit(event: dict[str, Any]) -> None:
            self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))
            self.wfile.flush()

        try:
            with self.app.engine.management():
                for event in self.app.engine.manager.install_stream(requested_model):
                    emit(event)
        except DownloadCancelled as error:
            try:
                emit({"type": "download", "status": "cancelled", "message": str(error)})
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
        except (BrokenPipeError, ConnectionResetError, OSError):
            self.app.engine.manager.cancel_download()
        except LlamaError as error:
            try:
                emit({"type": "error", "message": str(error)})
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass


    def _translate_nonstream(self, body):
        cancel = threading.Event()
        body["_cancel"] = cancel
        result = queue.Queue(maxsize=1)
        def run():
            try:
                result.put((self.app.engine.translate(body), None))
            except Exception as error:
                result.put((None, error))
        worker = threading.Thread(target=run, name="lat-translation-json", daemon=True)
        worker.start()
        try:
            while True:
                try:
                    value, error = result.get(timeout=.1)
                    if error is not None:
                        raise error
                    return value
                except queue.Empty:
                    readable, _, _ = select.select([self.connection], [], [], 0)
                    if readable and not self.connection.recv(1, socket.MSG_PEEK):
                        raise ConnectionResetError("翻译客户端已断开")
        finally:
            cancel.set()
            worker.join(timeout=4)

    def _stream_translation(self, body: dict[str, Any], *, openai: bool = False) -> None:
        self.send_response(200)
        self._headers("text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.connection.settimeout(2)
        cancelled, disconnected = threading.Event(), threading.Event()
        body["_cancel"] = cancelled
        events = queue.Queue(maxsize=16)

        def put(value):
            while not disconnected.is_set():
                try:
                    events.put(value, timeout=0.1)
                    return
                except queue.Full:
                    continue

        def produce():
            try:
                with closing(self.app.engine.translate_stream(body)) as stream:
                    for event in stream:
                        if disconnected.is_set():
                            break
                        put(event)
            except Exception as error:
                put({"type": "error", "message": str(error), "code": getattr(error, "code", "internal_error")})
            finally:
                put(None)

        worker = threading.Thread(target=produce, name="lat-translation-stream", daemon=True)
        worker.start()
        completion_id, created = "chatcmpl-local-" + uuid.uuid4().hex, int(time.time())
        model = self.app.settings.model_name

        def emit(value):
            data = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
            self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
            self.wfile.flush()

        def chunk(delta, finish=None):
            return {"id": completion_id, "object": "chat.completion.chunk", "created": created,
                    "model": model, "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}

        try:
            if openai:
                emit(chunk({"role": "assistant"}))
            while True:
                try:
                    event = events.get(timeout=0.25)
                except queue.Empty:
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
                    continue
                if event is None:
                    break
                if not openai:
                    emit(event)
                    continue
                if event.get("model"):
                    model = event["model"]
                elif self.app.engine.manager.client is not None:
                    model = self.app.engine.manager.client.resolve_model()
                if event["type"] == "plan" and event.get("translation"):
                    emit(chunk({"content": event["translation"]}))
                elif event["type"] == "segment_complete":
                    emit(chunk({"content": event["translation"]}))
                elif event["type"] == "complete":
                    emit(chunk({}, "stop"))
                    if isinstance(body.get("stream_options"), dict) and body["stream_options"].get("include_usage"):
                        emit({**chunk({}), "choices": [], "usage": self._usage(event.get("metrics"))})
                    emit("[DONE]")
                elif event["type"] in ("error", "cancelled"):
                    emit({"error": {"message": event.get("message", "翻译已取消"),
                                    "code": event.get("code", "translation_cancelled")}})
                    emit("[DONE]")
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            disconnected.set()
            cancelled.set()
            worker.join(timeout=4)

    @staticmethod
    def _usage(metrics):
        if not metrics:
            return None
        fields = {"prompt_tokens": metrics.get("prompt_tokens"),
                  "completion_tokens": metrics.get("generated_tokens"), "total_tokens": metrics.get("total_tokens")}
        return fields if all(isinstance(value, int) and not isinstance(value, bool) for value in fields.values()) else None

    def _chat_completion(self, body: dict[str, Any], text: str, model: str, metrics=None) -> None:
        result = {"id": "chatcmpl-local-" + uuid.uuid4().hex, "object": "chat.completion",
                  "created": int(time.time()), "model": model,
                  "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}]}
        usage = self._usage(metrics)
        if usage is not None:
            result["usage"] = usage
        self._json(200, result)


def serve(settings: Settings) -> None:
    if not settings.admin_token:
        raise LlamaError("命令行启动请先配置 LAT_ADMIN_TOKEN；桌面版自动创建会话密钥")
    settings.resolved_log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=[logging.StreamHandler(), logging.FileHandler(settings.resolved_log_file, encoding="utf-8")])
    app = App(settings)
    httpd = ThreadingHTTPServer((settings.host, settings.port), RequestHandler)
    httpd.app = app  # type: ignore[attr-defined]
    app.httpd = httpd
    app.engine.manager._remember_data_root(settings.resolved_data_root)
    app.telemetry.start()
    LOGGER.info("translator listening on http://%s:%s", settings.host, settings.port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("received Ctrl+C")
    finally:
        app.stopping.set()
        app.engine.begin_shutdown()
        app.telemetry.stop()
        httpd.server_close()
        app.engine.manager.shutdown()
