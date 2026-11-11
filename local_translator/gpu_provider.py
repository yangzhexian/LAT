"""Read-only NVIDIA monitoring, using the driver's NVML before nvidia-smi."""
from __future__ import annotations

import csv
import ctypes
import math
import os
from pathlib import Path
import subprocess
import time
from typing import Any


METRIC_KEYS = ("memory_used_mib", "memory_total_mib", "utilization_pct", "power_w", "power_limit_w", "temperature_c")


def number(value: str) -> float | None:
    try:
        result = float(value.strip())
        return result if math.isfinite(result) and result >= 0 else None
    except ValueError:
        return None


class NvmlError(RuntimeError):
    pass


class NvmlMemory(ctypes.Structure):
    # nvmlMemory_t (v1), bytes. Do not bind this layout to GetMemoryInfo_v2.
    _fields_ = [("total", ctypes.c_ulonglong), ("free", ctypes.c_ulonglong), ("used", ctypes.c_ulonglong)]


class NvmlUtilization(ctypes.Structure):
    _fields_ = [("gpu", ctypes.c_uint), ("memory", ctypes.c_uint)]


def load_nvml() -> Any:
    if os.name == "nt":
        # Load only the driver installation locations, never a DLL in the cwd.
        candidates = [Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "nvml.dll",
                      Path(os.environ.get("ProgramW6432", os.environ.get("ProgramFiles", r"C:\Program Files"))) / "NVIDIA Corporation" / "NVSMI" / "nvml.dll"]
    else:
        candidates = ["libnvidia-ml.so.1", "libnvidia-ml.so"]
    for candidate in candidates:
        try:
            return ctypes.CDLL(str(candidate))
        except OSError:
            continue
    raise NvmlError("未找到可加载的 NVIDIA NVML 驱动库")


class NvmlProvider:
    """Own one NVML initialization and stable UUID/device handles until close."""

    def __init__(self):
        self._library = load_nvml()
        self._initialized = False
        self._devices: list[tuple[Any, str, str]] = []
        uint_pointer = ctypes.POINTER(ctypes.c_uint)
        handle = ctypes.c_void_p
        self._init = self._bind(("nvmlInit_v2", "nvmlInit"), [])
        self._shutdown = self._bind(("nvmlShutdown",), [])
        self._count = self._bind(("nvmlDeviceGetCount_v2", "nvmlDeviceGetCount"), [uint_pointer])
        self._handle = self._bind(("nvmlDeviceGetHandleByIndex_v2", "nvmlDeviceGetHandleByIndex"), [ctypes.c_uint, ctypes.POINTER(handle)])
        self._uuid = self._bind(("nvmlDeviceGetUUID",), [handle, ctypes.POINTER(ctypes.c_char), ctypes.c_uint])
        self._name = self._bind(("nvmlDeviceGetName",), [handle, ctypes.POINTER(ctypes.c_char), ctypes.c_uint], required=False)
        self._memory = self._bind(("nvmlDeviceGetMemoryInfo",), [handle, ctypes.POINTER(NvmlMemory)], required=False)
        self._utilization = self._bind(("nvmlDeviceGetUtilizationRates",), [handle, ctypes.POINTER(NvmlUtilization)], required=False)
        self._power = self._bind(("nvmlDeviceGetPowerUsage",), [handle, uint_pointer], required=False)
        self._power_limit = self._bind(("nvmlDeviceGetPowerManagementLimit",), [handle, uint_pointer], required=False)
        self._temperature = self._bind(("nvmlDeviceGetTemperature",), [handle, ctypes.c_uint, uint_pointer], required=False)
        if not any((self._memory, self._utilization, self._power, self._power_limit, self._temperature)):
            raise NvmlError("NVML 驱动库缺少监测接口")
        try:
            self._require(self._init(), "初始化")
            self._initialized = True
            count = ctypes.c_uint()
            self._require(self._count(ctypes.byref(count)), "枚举显卡")
            for index in range(count.value):
                device = handle()
                self._require(self._handle(index, ctypes.byref(device)), "读取显卡句柄")
                identifier = self._string(self._uuid, device, required=True)
                name = self._string(self._name, device) or "NVIDIA GPU"
                self._devices.append((device, identifier, name))
        except (NvmlError, OSError):
            self.close()
            raise

    def _bind(self, names: tuple[str, ...], args: list[Any], *, required: bool = True) -> Any:
        for name in names:
            function = getattr(self._library, name, None)
            if function is not None:
                function.argtypes = args
                function.restype = ctypes.c_int
                return function
        if required:
            raise NvmlError(f"NVML 驱动库缺少 {names[0]}")
        return None

    @staticmethod
    def _require(code: int, operation: str) -> None:
        if code != 0:
            raise NvmlError(f"NVML {operation}失败（状态 {code}）")

    @staticmethod
    def _query(function: Any, *args: Any) -> bool:
        if function is None:
            return False
        code = function(*args)
        # Uninitialized, driver unavailable, GPU lost, driver/library mismatch.
        if code in (1, 9, 15, 18):
            raise NvmlError(f"NVML 驱动连接不可用（状态 {code}）")
        return code == 0

    def _string(self, function: Any, device: Any, *, required: bool = False) -> str:
        buffer = ctypes.create_string_buffer(256)
        valid = self._query(function, device, buffer, len(buffer))
        value = buffer.value.decode("utf-8", errors="replace").strip() if valid else ""
        if required and not value:
            raise NvmlError("NVML 无法读取显卡 UUID")
        return value

    def _scalar(self, function: Any, device: Any, *, scale: float = 1, temperature: bool = False) -> float | None:
        value = ctypes.c_uint()
        args = (device, 0, ctypes.byref(value)) if temperature else (device, ctypes.byref(value))
        if not self._query(function, *args) or value.value == 0xFFFFFFFF:
            return None
        return value.value / scale

    def read(self) -> list[dict[str, Any]]:
        gpus = []
        for device, identifier, name in self._devices:
            memory = NvmlMemory()
            memory_ok = self._query(self._memory, device, ctypes.byref(memory))
            utilization = NvmlUtilization()
            utilization_ok = self._query(self._utilization, device, ctypes.byref(utilization))
            gpus.append({
                "id": identifier, "name": name,
                "memory_used_mib": memory.used / 1048576 if memory_ok and memory.used != 0xFFFFFFFFFFFFFFFF else None,
                "memory_total_mib": memory.total / 1048576 if memory_ok and memory.total != 0xFFFFFFFFFFFFFFFF else None,
                "utilization_pct": utilization.gpu if utilization_ok and utilization.gpu <= 100 else None,
                "power_w": self._scalar(self._power, device, scale=1000),
                "power_limit_w": self._scalar(self._power_limit, device, scale=1000),
                "temperature_c": self._scalar(self._temperature, device, temperature=True),
            })
        return gpus

    def close(self) -> None:
        if self._initialized:
            self._initialized = False
            self._devices.clear()
            try:
                self._shutdown()
            except OSError:
                pass


class GpuProvider:
    """NVML first; bounded fallback polls keep their original sample timestamp."""

    def __init__(self):
        self._nvml: NvmlProvider | None = None
        self._attempted = False
        self._fallback_reason = ""
        self._fallback_sample: dict[str, Any] | None = None
        self._next_fallback = float("-inf")

    def read(self) -> dict[str, Any]:
        if not self._attempted:
            self._attempted = True
            try:
                self._nvml = NvmlProvider()
            except (NvmlError, OSError) as exc:
                self._fallback_reason = str(exc)
        if self._nvml is not None:
            try:
                gpus = self._nvml.read()
                partial = any(gpu[key] is None for gpu in gpus for key in METRIC_KEYS)
                return {"timestamp": time.time(), "gpus": gpus,
                        "message": "" if gpus else "未检测到可监测的 NVIDIA 显卡",
                        "provider": "nvml", "provider_status": ("partial" if partial else "ok") if gpus else "unavailable",
                        "provider_message": "部分指标不受驱动或显卡支持" if partial else "",
                        "provider_interval": None}
            except (NvmlError, OSError) as exc:
                self._fallback_reason = str(exc)
                self._nvml.close()
                self._nvml = None
        if self._fallback_sample is not None and time.monotonic() < self._next_fallback:
            return self._fallback_sample
        gpus = []
        message = ""
        try:
            result = subprocess.run([
                "nvidia-smi",
                "--query-gpu=uuid,name,memory.used,memory.total,utilization.gpu,power.draw,power.limit,temperature.gpu",
                "--format=csv,noheader,nounits",
            ], capture_output=True, text=True, errors="replace", timeout=2, check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if result.returncode != 0:
                message = "暂时无法读取 NVIDIA 显卡数据"
            else:
                for row in csv.reader(result.stdout.splitlines()):
                    if len(row) != 8 or not row[0].strip() or row[0].strip() in ("N/A", "[Not Supported]"):
                        continue
                    gpus.append({"id": row[0].strip(), "name": row[1].strip(),
                                 **{key: number(value) for key, value in zip(METRIC_KEYS, row[2:])}})
        except (OSError, subprocess.TimeoutExpired):
            message = "显卡监测不可用，请检查 NVIDIA 驱动"
        interval = 2.0 if gpus else 5.0
        self._fallback_sample = {"timestamp": time.time(), "gpus": gpus,
                                 "message": message or ("" if gpus else "未检测到可监测的 NVIDIA 显卡"),
                                 "provider": "nvidia-smi", "provider_status": "fallback" if gpus else "unavailable",
                                 "provider_message": self._fallback_reason, "provider_interval": interval}
        self._next_fallback = time.monotonic() + interval
        return self._fallback_sample

    def close(self) -> None:
        if self._nvml is not None:
            self._nvml.close()
            self._nvml = None
        self._attempted = False
        self._fallback_sample = None
        self._next_fallback = float("-inf")
