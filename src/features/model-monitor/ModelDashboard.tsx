import { useEffect, useId, useState } from "react";
import { getTelemetry } from "../../lib/api";
import type { GpuSample, TelemetrySample } from "../../types";

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

export function ModelDashboard({ interval = 2, windowSeconds = 120 }: { interval?: number; windowSeconds?: number }) {
  const [samples, setSamples] = useState<TelemetrySample[]>([]);
  const [latest, setLatest] = useState<TelemetrySample | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | null = null;
    async function poll() {
      if (stopped || document.hidden || active) return;
      const controller = new AbortController(); active = controller;
      const timeout = setTimeout(() => controller.abort(), 4500);
      try {
        const sample = await getTelemetry(controller.signal);
        if (stopped || document.hidden) return;
        setLatest(sample); setError(sample.message);
        setSamples((sample.samples || [sample]).filter((item) => item.timestamp >= sample.timestamp - windowSeconds));
      } catch {
        if (!stopped && !document.hidden) {
          setError("监测连接中断，图表保留上次数据，正在重连…");
          setSamples((previous) => [...previous, { timestamp: Date.now() / 1000, gpus: [], message: "" }].slice(-601));
        }
      } finally {
        clearTimeout(timeout); active = null;
        if (!stopped && !document.hidden) timer = setTimeout(() => void poll(), interval * 1000);
      }
    }
    function visibility() {
      clearTimeout(timer);
      if (document.hidden) active?.abort(); else void poll();
    }
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { stopped = true; clearTimeout(timer); active?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [interval, windowSeconds]);
  return <div className="model-dashboard">
    {error && <p className="monitor-notice" role="status">{error}</p>}
    {latest?.gpus.map((gpu) => <section key={gpu.id} className="gpu-section"><header className="gpu-heading"><h2>{gpu.name}</h2><span>{error ? "数据暂不可用 · " : ""}每 {interval} 秒刷新 · {new Date(latest.timestamp * 1000).toLocaleTimeString()} · 最近 {windowSeconds / 60} 分钟</span></header><div className="metrics-grid">{metrics.map((metric) => <Trend key={metric.key} samples={samples} gpu={gpu} metric={metric} windowSeconds={windowSeconds} />)}</div></section>)}
    {!latest && !error && <p className="empty-hint">正在读取显卡…</p>}
    {latest && !latest.gpus.length && <p className="empty-hint">监测不可用不影响本地翻译。支持的数值恢复后会自动更新。</p>}
  </div>;
}
