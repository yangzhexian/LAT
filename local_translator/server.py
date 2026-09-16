from __future__ import annotations

import json
import urllib.parse
import logging
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .catalog import MODEL_CATALOG, MODEL_ID
from .config import Settings
from .environment import inspect_download_environment
from .engine import TranslationEngine, TranslationOutputError, TranslationRequestError
from .errors import DownloadCancelled, LlamaError
from .version import __version__


LOGGER = logging.getLogger(__name__)

HTML_PAGE = """<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LAT</title>
<style>body{font-family:system-ui;margin:32px;background:#111827;color:#e5e7eb}main{max-width:1100px;margin:auto}.grid{display:flex;gap:16px}.panel{flex:1}textarea,input{width:100%;box-sizing:border-box;background:#1f2937;color:#fff;border:1px solid #374151;border-radius:8px;padding:12px}textarea{min-height:260px}button{border:0;border-radius:7px;padding:10px 15px;background:#2563eb;color:#fff}button.secondary{background:#374151}.toolbar{display:flex;gap:12px;align-items:end;margin:16px 0}.muted{color:#9ca3af}</style>
</head><body><main><h1>LAT · Local AI Translator</h1><p class="muted">使用本机 llama.cpp 运行 Hy-MT2 不发送到云端</p>
<div class="toolbar"><label>目标语言<input id="target" value="English"></label><button class="secondary" id="statusButton">刷新状态</button><button class="secondary" id="unloadButton">关闭模型</button></div>
<div class="grid"><section class="panel"><label>原文<textarea id="source"></textarea></label></section><section class="panel"><label>译文<textarea id="result" readonly></textarea></label></section></div>
<div class="toolbar"><button id="translateButton">翻译</button><span id="status"></span></div><div id="message" class="muted"></div></main>
<script>
const $=id=>document.getElementById(id);
async function status(){try{const r=await fetch('/admin/status');const d=await r.json();$('status').textContent=d.ready?'llama.cpp · 已启用':'模型未启用'}catch(e){$('status').textContent='翻译网关未运行'}}
async function unload(){try{await fetch('/admin/unload',{method:'POST'});$('message').textContent='模型已关闭';await status()}catch(e){$('message').textContent='关闭失败'}};
async function translate(){const text=$('source').value.trim();if(!text)return;$('translateButton').disabled=true;try{const r=await fetch('/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,target_language:$('target').value})});const d=await r.json();if(!r.ok)throw Error(d.error?.message||'请求失败');$('result').value=d.translation;$('message').textContent='完成'}catch(e){$('message').textContent='翻译失败：'+e.message}finally{$('translateButton').disabled=false}}
$('translateButton').onclick=translate;$('unloadButton').onclick=unload;$('statusButton').onclick=status;status();
</script></body></html>"""


class App:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.engine = TranslationEngine(settings)
        self.httpd: ThreadingHTTPServer | None = None

    def stop(self) -> None:
        self.engine.manager.shutdown()
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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

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
        self.send_response(HTTPStatus.NO_CONTENT)
        self._headers()
        self.end_headers()

    def do_GET(self) -> None:
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
                self._json(200, {"status": "ok", "service": "lat-local-translator"})
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
        try:
            if self.path == "/admin/directory":
                body = self._read_json()
                root_dir = body.get("root_dir")
                if not isinstance(root_dir, str) or not root_dir.strip():
                    raise TranslationRequestError("数据目录不能为空")
                self._json(200, {"status": "configured", "root_dir": str(self.app.engine.manager.set_data_root(root_dir)["runtime"]["root_dir"])})
                return
            if self.path in {"/admin/start", "/admin/engine/start"}:
                client = self.app.engine.manager.ensure_server()
                self._json(200, {"status": "started", "backend": "llama.cpp", "model": client.resolve_model()})
                return
            if self.path in {"/admin/load", "/admin/engine/load"}:
                body = self._read_optional_json()
                requested_model = body.get("model", self.app.engine.manager.settings.model_name)
                if not isinstance(requested_model, str) or requested_model not in MODEL_CATALOG:
                    raise TranslationRequestError("不支持的 Hy-MT2 模型版本")
                self.app.engine.manager.settings.model_name = requested_model
                client = self.app.engine.manager.ensure_server()
                self._json(200, {"status": "loaded", "model": client.resolve_model()})
                return
            if self.path in {"/admin/unload", "/admin/engine/stop"}:
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
            if self.path == "/translate/stream":
                self._stream_translation(body)
                return
            result = self.app.engine.translate(body)
            if self.path == "/translate":
                self._json(200, {"translation": result.text, "model": result.model, "quality_issues": result.issues, "metrics": result.metrics})
                return
            self._chat_completion(body, result.text, result.model)
        except TranslationRequestError as error:
            self._json(400, {"error": {"message": str(error), "type": "invalid_request_error"}})
        except TranslationOutputError as error:
            self._json(502, {"error": {"message": str(error), "type": "model_output_error"}})
        except LlamaError as error:
            self._json(503, {"error": {"message": str(error), "type": "llama_runtime_error"}})
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


    def _stream_translation(self, body: dict[str, Any]) -> None:
        self.send_response(200)
        self._headers("text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        stream = self.app.engine.translate_stream(body)
        try:
            for event in stream:
                self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (TranslationRequestError, TranslationOutputError, LlamaError) as error:
            try:
                self.wfile.write(f"data: {json.dumps({'type': 'error', 'message': str(error)}, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            stream.close()

    def _chat_completion(self, body: dict[str, Any], text: str, model: str) -> None:
        completion_id = f"chatcmpl-local-{uuid.uuid4().hex}"
        created = int(time.time())
        if body.get("stream") is True:
            self.send_response(200)
            self._headers("text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            for delta in ({"role": "assistant"}, {"content": text}):
                event = {"id": completion_id, "object": "chat.completion.chunk", "created": created, "model": model, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]}
                self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
            final = {"id": completion_id, "object": "chat.completion.chunk", "created": created, "model": model, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
            self.wfile.write(f"data: {json.dumps(final, ensure_ascii=False)}\n\ndata: [DONE]\n\n".encode("utf-8"))
            self.wfile.flush()
            return
        self._json(200, {"id": completion_id, "object": "chat.completion", "created": created, "model": model, "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}})


def serve(settings: Settings) -> None:
    settings.resolved_log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=[logging.StreamHandler(), logging.FileHandler(settings.resolved_log_file, encoding="utf-8")])
    app = App(settings)
    httpd = ThreadingHTTPServer((settings.host, settings.port), RequestHandler)
    httpd.app = app  # type: ignore[attr-defined]
    app.httpd = httpd
    LOGGER.info("translator listening on http://%s:%s", settings.host, settings.port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("received Ctrl+C")
    finally:
        httpd.server_close()
        app.engine.manager.shutdown()
