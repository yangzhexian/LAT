import type { TelemetrySample, TelemetrySnapshot } from "../types";

export function mergeGpuSamples(previous: TelemetrySample[], next: TelemetrySnapshot, previousSession?: string): TelemetrySample[] {
  const reset = next.reset || (previousSession !== undefined && next.session_id !== previousSession);
  const samples = new Map<number, TelemetrySample>();
  for (const sample of reset ? [] : previous) samples.set(sample.timestamp, sample);
  for (const sample of next.samples ?? [next]) samples.set(sample.timestamp, sample);
  const latest = Math.max(next.timestamp, ...samples.keys());
  return [...samples.values()].filter((sample) => sample.timestamp >= latest - 300).sort((left, right) => left.timestamp - right.timestamp).slice(-601);
}
