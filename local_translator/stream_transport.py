"""Bounded loopback HTTP/SSE reader with cancellation during every socket wait."""
from __future__ import annotations

import http.client
import io
import errno
import select
import socket
import threading
import time
from urllib.parse import urlsplit

from .errors import LlamaError, LlamaHTTPError
from .jobs import TranslationCancelled


def stream_lines(url: str, body: bytes, settings, cancel: threading.Event | None = None):
    target = urlsplit(url)
    started = last_data = time.monotonic()
    received = False
    wire = bytearray()

    def check():
        if cancel is not None and cancel.is_set():
            raise TranslationCancelled()
        now = time.monotonic()
        if now - started > settings.request_timeout_seconds:
            raise LlamaError("模型调用超过总时限")
        if not received and now - started > settings.first_response_timeout_seconds:
            raise LlamaError("等待模型首响应超时")
        if received and now - last_data > settings.stream_idle_timeout_seconds:
            raise LlamaError("模型输出流长时间没有数据")

    check()
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setblocking(False)
        result = sock.connect_ex((target.hostname, target.port or 80))
        pending = (errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY, 10035, 10036, 10037)
        if result and result not in pending:
            raise OSError(result, "无法连接模型端口")
        while result:
            check()
            if time.monotonic() - started > settings.connect_timeout_seconds:
                raise LlamaError("连接模型端口超时")
            _, writable, exceptional = select.select([], [sock], [sock], .1)
            if writable or exceptional:
                result = sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                if result:
                    raise OSError(result, "无法连接模型端口")
        # A timed-out buffered HTTPResponse cannot be resumed reliably. Keep our
        # own framing buffer and poll recv instead; no stranded reader thread.
        sock.settimeout(.1)
        packet = (f"POST {target.path} HTTP/1.1\r\nHost: {target.netloc}\r\n"
                  "Content-Type: application/json\r\nAccept: text/event-stream\r\n"
                  f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n").encode() + body
        sent = 0
        while sent < len(packet):
            check()
            try:
                count = sock.send(packet[sent:])
            except socket.timeout:
                continue
            if not count:
                raise LlamaError("模型连接在发送请求时关闭")
            sent += count

        def receive():
            nonlocal last_data
            while True:
                check()
                try:
                    value = sock.recv(65536)
                except socket.timeout:
                    continue
                check()
                if value:
                    last_data = time.monotonic()
                return value

        def need(length):
            while len(wire) < length:
                value = receive()
                if not value:
                    raise LlamaError("incomplete_stream: 模型 HTTP 响应提前结束")
                wire.extend(value)

        def framing_line():
            while b"\r\n" not in wire:
                if len(wire) > 65536:
                    raise LlamaError("模型 HTTP 行超过限制")
                need(len(wire) + 1)
            end = wire.index(b"\r\n")
            value = bytes(wire[:end])
            del wire[:end + 2]
            return value

        while b"\r\n\r\n" not in wire:
            if len(wire) > 65536:
                raise LlamaError("模型 HTTP 响应头超过限制")
            need(len(wire) + 1)
        end = wire.index(b"\r\n\r\n")
        raw_headers = bytes(wire[:end])
        del wire[:end + 4]
        status_line, header_bytes = raw_headers.split(b"\r\n", 1) if b"\r\n" in raw_headers else (raw_headers, b"")
        status = int(status_line.split()[1])
        headers = http.client.parse_headers(io.BytesIO(header_bytes + b"\r\n\r\n"))

        def chunks():
            if headers.get("Transfer-Encoding", "").lower() == "chunked":
                while True:
                    size = int(framing_line().split(b";", 1)[0], 16)
                    if size == 0:
                        return
                    if size < 0 or size > 1_048_576:
                        raise LlamaError("模型 HTTP 分块超过限制")
                    need(size + 2)
                    if wire[size:size + 2] != b"\r\n":
                        raise LlamaError("模型 HTTP 分块格式无效")
                    value = bytes(wire[:size])
                    del wire[:size + 2]
                    yield value
            else:
                remaining = int(headers["Content-Length"]) if headers.get("Content-Length") else None
                while remaining is None or remaining > 0:
                    check()
                    value = bytes(wire) if wire else receive()
                    wire.clear()
                    if not value:
                        if remaining:
                            raise LlamaError("incomplete_stream: 模型 HTTP 响应长度不足")
                        return
                    if remaining is not None:
                        value = value[:remaining]
                        remaining -= len(value)
                    yield value

        if status >= 400:
            detail = bytearray()
            for value in chunks():
                detail.extend(value[:8192 - len(detail)])
                if len(detail) >= 8192:
                    break
            raise LlamaHTTPError(status, detail.decode("utf-8", errors="replace"))
        lines = bytearray()
        for value in chunks():
            lines.extend(value)
            while b"\n" in lines:
                end = lines.index(b"\n") + 1
                if end > 1_048_576:
                    raise LlamaError("模型事件超过 1 MiB 限制")
                line = bytes(lines[:end])
                del lines[:end]
                if line.startswith(b"data:"):
                    received = True
                check()
                yield line
            if len(lines) > 1_048_576:
                raise LlamaError("模型事件超过 1 MiB 限制")
        check()
        if lines:
            yield bytes(lines)
    except (OSError, ValueError, IndexError, http.client.HTTPException) as error:
        check()
        raise LlamaError(f"llama.cpp 流式连接失败: {error}") from error
    finally:
        if sock is not None:
            sock.close()
