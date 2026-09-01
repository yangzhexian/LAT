from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any

from .config import Settings
from .engine import TranslationEngine, TranslationRequestError
from .errors import LlamaError
from .server import serve


def _gateway_request(settings: Settings, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"http://{settings.host}:{settings.port}{path}",
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="LAT 本地 llama.cpp 翻译网关")
    parser.add_argument("--config", default=None, help="JSON 配置文件路径")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("serve", aliases=["start"], help="启动本地翻译网关")
    sub.add_parser("status", help="查看网关和 llama.cpp 状态")
    sub.add_parser("unload", help="关闭模型并释放显存")
    sub.add_parser("stop", help="停止网关和模型进程")
    translate = sub.add_parser("translate", help="直接翻译一段文本")
    translate.add_argument("--to", required=True, dest="target_language", help="目标语言")
    translate.add_argument("--from", dest="source_language", default=None, help="源语言")
    translate.add_argument("text", nargs="?", help="文本；不提供时从 stdin 读取")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    settings = Settings.from_file(args.config)
    if args.command in {"serve", "start"}:
        serve(settings)
        return 0
    if args.command == "status":
        try:
            print(json.dumps(_gateway_request(settings, "GET", "/admin/status"), ensure_ascii=False, indent=2))
            return 0
        except (urllib.error.URLError, OSError):
            print("翻译网关未运行", file=sys.stderr)
            return 1
    if args.command == "unload":
        try:
            print(json.dumps(_gateway_request(settings, "POST", "/admin/unload"), ensure_ascii=False, indent=2))
            return 0
        except (urllib.error.URLError, OSError) as error:
            print(f"无法连接翻译网关: {error}", file=sys.stderr)
            return 1
    if args.command == "stop":
        try:
            print(json.dumps(_gateway_request(settings, "POST", "/admin/shutdown"), ensure_ascii=False, indent=2))
            return 0
        except (urllib.error.URLError, OSError) as error:
            print(f"无法连接翻译网关: {error}", file=sys.stderr)
            return 1
    if args.command == "translate":
        text = args.text if args.text is not None else sys.stdin.read()
        engine = TranslationEngine(settings)
        try:
            result = engine.translate({"text": text, "source_language": args.source_language, "target_language": args.target_language})
            print(result.text)
            return 0
        except (TranslationRequestError, LlamaError, RuntimeError) as error:
            print(str(error), file=sys.stderr)
            return 1
        finally:
            engine.manager.shutdown()
    parser.error("未知命令")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
