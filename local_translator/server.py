from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .config import Settings
from .environment import DOWNLOAD_MODEL, inspect_download_environment
from .engine import TranslationEngine, TranslationOutputError, TranslationRequestError
from .ollama_client import OllamaError


LOGGER = logging.getLogger(__name__)

HTML_PAGE = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LAT · Local AI Translator</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    body { margin: 0; background: #111827; color: #e5e7eb; }
    main { max-width: 1100px; margin: 32px auto; padding: 0 20px; }
    h1 { margin-bottom: 6px; } .muted { color: #9ca3af; }
    .toolbar, .grid { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .grid { align-items: stretch; margin-top: 20px; } .panel { flex: 1 1 420px; }
    textarea, input { box-sizing: border-box; width: 100%; border: 1px solid #374151; border-radius: 8px; background: #1f2937; color: #f9fafb; padding: 12px; font: inherit; }
    textarea { min-height: 260px; resize: vertical; } label { display: block; margin: 8px 0; color: #d1d5db; }
    button { border: 0; border-radius: 7px; padding: 10px 15px; background: #2563eb; color: white; cursor: pointer; }
    button.secondary { background: #374151; } button:disabled { opacity: .55; cursor: wait; }
    #status, #message { min-height: 1.4em; } #status { color: #93c5fd; }
  </style>
</head>
<body>
<main>
  <h1>Hy-MT2 本地翻译</h1>
  <div class="muted">仅使用本机 Ollama 不发送到云端 也可作为 nextai-translator 的 OpenAI 兼容后端</div>
  <div class="toolbar" style="margin-top:18px">
    <label style="width:180px">目标语言<input id="target" value="English"></label>
    <label style="flex:1;min-width:260px">风格（可选）<input id="style" placeholder="例如：自然、简洁、正式"></label>
    <button class="secondary" id="statusButton">刷新状态</button>
    <button class="secondary" id="unloadButton">卸载模型</button>
  </div>
  <div class="grid">
    <section class="panel"><label>原文</label><textarea id="source" placeholder="输入要翻译的文本"></textarea></section>
    <section class="panel"><label>译文</label><textarea id="result" readonly placeholder="译文会显示在这里"></textarea></section>
  </div>
  <div class="toolbar" style="margin-top:16px"><button id="translateButton">翻译</button><span id="status"></span></div>
  <div id="message" class="muted"></div>
</main>
<script>
const $ = id => document.getElementById(id);
async function status() {
  try { const r = await fetch('/admin/status'); const d = await r.json();
    $('status').textContent = d.ready ? `Ollama ${d.version || ''} · ${d.resolved_model || d.model_configured} · 已加载 ${d.running_models?.length || 0} 个模型` : 'Ollama 未运行';
  } catch (e) { $('status').textContent = '翻译网关未运行'; }
}
async function unload() {
  $('unloadButton').disabled = true;
  try { await fetch('/admin/unload', {method:'POST'}); $('message').textContent = '模型已卸载'; await status(); }
  catch (e) { $('message').textContent = '卸载失败：' + e; }
  finally { $('unloadButton').disabled = false; }
}
async function translate() {
  const source = $('source').value.trim(); if (!source) return;
  $('translateButton').disabled = true; $('message').textContent = '正在翻译…';
  try { const r = await fetch('/translate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:source,target_language:$('target').value,style:$('style').value})}); const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || '请求失败'); $('result').value = d.translation; $('message').textContent = d.quality_issues?.length ? '译文已返回（有非致命质量提示）' : '完成'; await status();
  } catch (e) { $('message').textContent = '翻译失败：' + e.message; }
  finally { $('translateButton').disabled = false; }
}
$('translateButton').onclick = translate; $('unloadButton').onclick = unload; $('statusButton').onclick = status; status();
</script>
</body></html>"""


class App:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.engine = TranslationEngine(settings)
        self.httpd: ThreadingHTTPServer | None = None

    def stop(self) -> None:
        if self.httpd is not None:
            self.httpd.shutdown()


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "HyMT2LocalTranslator/0.1"

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
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
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
                self._json(200, {"status": "ok", "service": "hy-mt2-local-translator"})
                return
            if self.path == "/admin/status":
                self._json(200, self.app.engine.manager.status())
                return
            if self.path == "/admin/environment":
                self._json(200, inspect_download_environment())
                return
            if self.path == "/v1/models":
                status = self.app.engine.manager.status()
                self._json(
                    200,
                    {
                        "object": "list",
                        "data": [
                            {
                                "id": status.get("resolved_model") or self.app.settings.model_name,
                                "object": "model",
                                "owned_by": "local-ollama",
                            }
                        ],
                    },
                )
                return
            self._json(404, {"error": {"message": "not found", "type": "not_found"}})
        except Exception as error:  # status must remain useful even when Ollama is down
            self._json(503, {"error": {"message": str(error), "type": "service_unavailable"}})

    def do_POST(self) -> None:
        try:
            if self.path == "/admin/start":
                client = self.app.engine.manager.ensure_server()
                self._json(200, {"status": "started", "ollama": client.version()})
                return
            if self.path == "/admin/load":
                body = self._read_optional_json()
                client = self.app.engine.manager.ensure_server()
                requested_model = body.get("model")
                if isinstance(requested_model, str) and requested_model.strip():
                    client.select_model(requested_model)
                model = client.resolve_model()
                self._json(200, {"status": "loaded", "model": model, "response": client.load(model)})
                return
            if self.path == "/admin/unload":
                body = self._read_optional_json()
                client = self.app.engine.manager.ensure_server()
                requested_model = body.get("model")
                if isinstance(requested_model, str) and requested_model.strip():
                    client.select_model(requested_model)
                model = client.resolve_model()
                self._json(200, {"status": "unloaded", "model": model, "response": client.unload(model)})
                return
            if self.path == "/admin/shutdown":
                self._json(200, {"status": "shutting_down"})
                threading.Thread(target=self.app.stop, daemon=True).start()
                return
            if self.path == "/admin/download":
                self._stream_download(self._read_json())
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
                self._json(
                    200,
                    {
                        "translation": result.text,
                        "model": result.model,
                        "quality_issues": result.issues,
                        "metrics": getattr(result, "metrics", None),
                    },
                )
                return
            self._chat_completion(body, result.text, result.model)
        except TranslationRequestError as error:
            self._json(400, {"error": {"message": str(error), "type": "invalid_request_error"}})
        except TranslationOutputError as error:
            self._json(502, {"error": {"message": str(error), "type": "model_output_error"}})
        except OllamaError as error:
            self._json(503, {"error": {"message": str(error), "type": "ollama_error"}})
        except Exception as error:
            LOGGER.exception("request failed")
            self._json(500, {"error": {"message": str(error), "type": "internal_error"}})

    def _stream_download(self, body: dict[str, Any]) -> None:
        requested_model = body.get("model", DOWNLOAD_MODEL)
        if not isinstance(requested_model, str) or requested_model.strip() != DOWNLOAD_MODEL:
            raise TranslationRequestError(f"当前下载入口只支持 {DOWNLOAD_MODEL}")

        client = self.app.engine.manager.ensure_server()
        installed = {
            item.get("name")
            for item in client.tags()
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        }
        self.send_response(200)
        self._headers("text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def emit(event: dict[str, Any]) -> None:
            self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))
            self.wfile.flush()

        if DOWNLOAD_MODEL in installed:
            emit({"type": "download", "status": "already_present", "percent": 100})
            return

        try:
            for event in client.pull_stream(DOWNLOAD_MODEL):
                total = event.get("total")
                completed = event.get("completed")
                progress: dict[str, Any] = {
                    "type": "download",
                    "status": event.get("status", "downloading"),
                }
                if isinstance(total, (int, float)) and total > 0 and isinstance(completed, (int, float)):
                    progress["percent"] = round(min(100.0, completed * 100 / total), 1)
                    progress["completed_bytes"] = completed
                    progress["total_bytes"] = total
                if isinstance(event.get("digest"), str):
                    progress["digest"] = event["digest"]
                if isinstance(event.get("error"), str):
                    progress.update({"type": "error", "message": event["error"]})
                emit(progress)
        except OllamaError as error:
            emit({"type": "error", "message": str(error)})

    def _stream_translation(self, body: dict[str, Any]) -> None:
        self.send_response(200)
        self._headers("text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            for event in self.app.engine.translate_stream(body):
                self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
        except (TranslationRequestError, TranslationOutputError, OllamaError) as error:
            event = {"type": "error", "message": str(error)}
            self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))
            self.wfile.flush()

    def _chat_completion(self, body: dict[str, Any], text: str, model: str) -> None:
        completion_id = f"chatcmpl-local-{uuid.uuid4().hex}"
        created = int(time.time())
        if body.get("stream") is True:
            self.send_response(200)
            self._headers("text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            # BaseHTTPRequestHandler uses HTTP/1.0 by default. Explicitly
            # close the response so clients know where the SSE stream ends;
            # keeping an un-sized HTTP/1.0 response alive makes PowerShell's
            # Invoke-WebRequest wait forever after [DONE].
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            chunks = [
                {"role": "assistant"},
                {"content": text},
            ]
            for delta in chunks:
                event = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
                }
                self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
            final = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            self.wfile.write(f"data: {json.dumps(final, ensure_ascii=False)}\n\ndata: [DONE]\n\n".encode("utf-8"))
            self.wfile.flush()
            return

        self._json(
            200,
            {
                "id": completion_id,
                "object": "chat.completion",
                "created": created,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            },
        )


def serve(settings: Settings) -> None:
    settings.resolved_log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(settings.resolved_log_file, encoding="utf-8")],
    )
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
