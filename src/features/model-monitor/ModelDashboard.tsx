import { useEffect, useId, useMemo, useRef, useState } from "react";
import { EmptyState, Notice, Tabs } from "../../components/Controls";
import { getGpuTelemetry, getInferenceTelemetry } from "../../lib/api";
import type { GpuSample, InferenceSnapshot, TelemetrySample, TelemetrySnapshot } from "../../types";
import { mergeGpuSamples } from "../../lib/gpuSamples";
import { InferenceDashboard } from "./InferenceDashboard";

interface Metric { key: keyof GpuSample; label: string; unit: string; scale: (gpu: GpuSample) => number; convert?: number }
const metrics: Metric[] = [
  { key: "memory_used_mib", label: "显存占用", unit: "GiB", scale: (gpu) => (gpu.memory_total_mib || 1024) / 1024, convert: 1024 },
  { key: "utilization_pct", label: "GPU 利用率", unit: "%", scale: () => 100 },
  { key: "power_w", label: "显卡功率", unit: "W", scale: (gpu) => gpu.power_limit_w || 100 },
  { key: "temperature_c", label: "显卡温度", unit: "°C", scale: () => 100 },
];

function Trend({ samples, gpu, metric, windowSeconds }: { samples: TelemetrySample[]; gpu: GpuSample; metric: Metric; windowSeconds: number }) {
  const gradient = useId().replace(/:/g, "");
  const values = samples.map((sample) => {
    const value = sample.gpus.find((item) => item.id === gpu.id)?.[metric.key];
    return { time: sample.timestamp, value: typeof value === "number" ? value / (metric.convert || 1) : null };
  });
  const max = Math.max(metric.scale(gpu), ...values.map((point) => point.value || 0), 1);
  const end = samples.at(-1)?.timestamp || 0;
  let drawing = false;
  const path = values.map(({ time, value }) => {
    if (value === null) { drawing = false; return ""; }
    const x = Math.max(0, Math.min(400, 400 * (time - end + windowSeconds) / windowSeconds));
    const y = 130 - value / max * 120;
    const command = `${drawing ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    drawing = true;
    return command;
  }).join(" ");
  const current = gpu[metric.key];
  const label = typeof current === "number" ? (current / (metric.convert || 1)).toFixed(metric.unit === "GiB" ? 2 : 0) + " " + metric.unit : "暂不可用";
  return <article className={"metric-card metric-" + metric.key}>
    <header><h3>{metric.label}</h3><span>{label}</span></header>
    <svg className="metric-chart" viewBox="0 0 440 158" role="img" aria-label={`${gpu.name} ${metric.label}，最近 ${windowSeconds} 秒，当前 ${label}`}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0"><stop stopColor="currentColor" stopOpacity=".35" /><stop offset="1" stopColor="currentColor" /></linearGradient></defs>
      {[10, 70, 130].map((y) => <line key={y} x1="0" y1={y} x2="400" y2={y} className="chart-grid" />)}
      <text x="405" y="14">{max.toFixed(metric.unit === "GiB" ? 1 : 0)}</text><text x="405" y="134">0</text>
      {path && <path d={path} fill="none" stroke={`url(#${gradient})`} strokeWidth="2.5" strokeLinecap="round" />}
      {values.length === 1 && values[0].value !== null && <circle cx="400" cy={130 - values[0].value / max * 120} r="3" fill="currentColor" />}
      <text x="0" y="155">{windowSeconds} 秒</text><text x="373" y="155">现在</text>
    </svg>
    <p>{metric.key === "memory_used_mib" ? `整卡显存 · 总量 ${gpu.memory_total_mib === null ? "未知" : (gpu.memory_total_mib / 1024).toFixed(1) + " GiB"}` : metric.key === "power_w" ? `整卡功耗 · 功率上限 ${gpu.power_limit_w ?? "未知"} W` : metric.key === "temperature_c" ? "GPU 核心温度 · 实时趋势" : "整卡计算负载 · 实时趋势"}</p>
  </article>;
}

export function ModelDashboard({ interval = 2, windowSeconds = 120 }: { interval?: number; windowSeconds?: number; reduceMotion?: boolean }) {
  const [view, setView] = useState<"inference" | "gpu">("inference");
  const tabId = useId();
  const [samples, setSamples] = useState<TelemetrySample[]>([]);
  const [latest, setLatest] = useState<TelemetrySnapshot | null>(null);
  const latestGpu = useRef<TelemetrySnapshot | null>(null);
  const [inference, setInference] = useState<InferenceSnapshot | null>(null);
  const visibleSamples = useMemo(() => {
    const end = samples.at(-1)?.timestamp ?? 0;
    return samples.filter((sample) => sample.timestamp >= end - windowSeconds);
  }, [samples, windowSeconds]);
  const effectiveInterval = Math.max(interval, latest?.provider_interval ?? 0);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    let stopped = false;
    setError("");
    setConnected(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | null = null;
    async function poll() {
      if (stopped || document.hidden || active) return;
      const controller = new AbortController(); active = controller;
      const timeout = setTimeout(() => controller.abort(), 4500);
      try {
        if (view === "gpu") {
          const previous = latestGpu.current;
          const sample = await getGpuTelemetry(controller.signal, previous?.cursor, previous?.session_id);
          if (stopped || document.hidden || controller.signal.aborted) return;
          setSamples((current) => mergeGpuSamples(current, sample, previous?.session_id));
          latestGpu.current = sample;
          setLatest(sample);
        } else {
          const snapshot = await getInferenceTelemetry(controller.signal);
          if (stopped || document.hidden || controller.signal.aborted) return;
          setInference(snapshot);
        }
        setError(""); setConnected(true);
      } catch {
        if (!stopped && !document.hidden && controller.signal.reason !== "hidden") {
          setError("监测连接中断，图表保留上次数据，正在重连…");
          setConnected(false);
          if (view === "gpu") setSamples((previous) => {
            const timestamp = Date.now() / 1000;
            return [...previous.filter((sample) => sample.timestamp >= timestamp - 300), { timestamp, gpus: [], message: "" }].slice(-601);
          });
        }
      } finally {
        clearTimeout(timeout); active = null;
        if (!stopped && !document.hidden) timer = setTimeout(() => void poll(), Math.max(interval, view === "gpu" ? latestGpu.current?.provider_interval ?? 0 : 0) * 1000);
      }
    }
    function visibility() {
      clearTimeout(timer);
      if (document.hidden) active?.abort("hidden"); else void poll();
    }
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { stopped = true; clearTimeout(timer); active?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [interval, view]);
  return <div className="model-dashboard">
    <Tabs id={tabId} label="性能监测视图" value={view} onChange={setView}
      options={[{ value: "inference", label: "模型推理" }, { value: "gpu", label: "GPU 硬件" }]} className="preview-tabs monitor-tabs" />
    {error && <Notice className="monitor-notice">{error}</Notice>}
    <div role="tabpanel" id={`${tabId}-inference-panel`} aria-labelledby={`${tabId}-inference-tab`} hidden={view !== "inference"} tabIndex={0}>
      {view === "inference" && (inference ? <InferenceDashboard inference={inference} connected={connected} /> : !error && <EmptyState title="正在读取推理监测…" />)}
    </div>
    <div role="tabpanel" id={`${tabId}-gpu-panel`} aria-labelledby={`${tabId}-gpu-tab`} hidden={view !== "gpu"} tabIndex={0}>
      {view === "gpu" && <>
        {latest?.provider_message && <Notice className="monitor-notice">采样来源：{latest.provider || "暂不可用"} · {latest.provider_message}</Notice>}
        {latest?.message && <Notice className="monitor-notice">{latest.message}</Notice>}
        {latest?.gpus.map((gpu) => <section key={gpu.id} className="gpu-section"><header className="gpu-heading"><h2>{gpu.name}</h2><span>{error || latest.message ? "数据暂不可用 · " : ""}每 {effectiveInterval} 秒刷新 · {new Date(latest.timestamp * 1000).toLocaleTimeString()} · 最近 {windowSeconds / 60} 分钟</span></header><div className="metrics-grid">{metrics.map((metric) => <Trend key={metric.key} samples={visibleSamples} gpu={gpu} metric={metric} windowSeconds={windowSeconds} />)}</div></section>)}
        {!latest && !error && <EmptyState title="正在读取显卡…" />}
        {latest && !latest.gpus.length && <EmptyState title="显卡监测暂不可用">本地翻译仍可使用，支持的数值恢复后会自动更新。</EmptyState>}
      </>}
    </div>
  </div>;
}
