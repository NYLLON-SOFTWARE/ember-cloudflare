import type { Results } from "./report.ts";

// Compares the headline numbers of two runs, ideally from the same machine: a baseline from main
// and a run from a branch, say. Changes smaller than a metric's noise floor are ignored.

interface Metric {
  name: string;
  value: number;
  better: "lower" | "higher";
  /** The smallest difference worth reporting, in the metric's own unit. */
  floor: number;
}

function collect({ backend, web }: Results): Map<string, Metric> {
  const metrics = new Map<string, Metric>();
  const add = (name: string, value: number | null | undefined, better: Metric["better"] = "lower", floor = 1) => {
    if (typeof value === "number" && Number.isFinite(value)) metrics.set(name, { name, value, better, floor });
  };

  for (const [storage, r] of Object.entries(backend)) {
    add(`${storage} latency: ack p50 ms`, r.latency?.ack?.p50);
    add(`${storage} latency: ack p99 ms`, r.latency?.ack?.p99);
    add(`${storage} latency: delivery p50 ms`, r.latency?.delivery?.p50);
    add(`${storage} throughput: messages/s`, r.throughput?.messagesPerSecond, "higher", 10);
    add(`${storage} throughput: ack p95 ms`, r.throughput?.ack?.p95);
    for (const f of r.fanout ?? []) {
      add(`${storage} fan-out ${f.members}: delivery p50 ms`, f.delivery?.p50);
      add(`${storage} fan-out ${f.members}: delivery p99 ms`, f.delivery?.p99);
    }
    for (const step of r.connections?.steps ?? []) {
      add(`${storage} room of ${step.members}: join p50 ms`, step.connect?.p50);
      add(`${storage} room of ${step.members}: presence KB per join`, step.presenceKbPerJoin);
    }
    add(`${storage} history: welcome p50 ms`, r.history?.welcome?.p50);
    add(`${storage} history: page p50 ms`, r.history?.page?.p50);
  }

  if (web) {
    add("bundle: JS+CSS gzip KB", web.bundle.code.gzipKb);
    for (const l of web.lighthouse) {
      const page = `lighthouse ${l.page} ${l.formFactor}`;
      add(`${page}: score`, l.score, "higher");
      add(`${page}: LCP ms`, l.lcpMs, "lower", 50);
      add(`${page}: TBT ms`, l.tbtMs, "lower", 20);
      add(`${page}: CLS`, l.cls, "lower", 0.01);
    }
    for (const r of web.render) {
      add(`render ${r.cpuSlowdown}x: room ready ms`, r.roomReadyMs, "lower", 20);
      r.bursts.forEach((b, i) => {
        // Timelines grow by whatever paging brings in, so label them by position, not exact size.
        const label = `render ${r.cpuSlowdown}x ${i === 0 ? "short" : "long"} timeline`;
        add(`${label}: frame to paint p95 ms`, b.frameToPaint?.p95);
        add(`${label}: main thread ms per message`, b.mainThreadMsPerMessage, "lower", 0.5);
      });
    }
  }
  return metrics;
}

/** Prints how `after` moved against `before`. Returns how many metrics got worse by more than `threshold` percent. */
export function compare(before: Results, after: Results, threshold: number): number {
  const old = collect(before);
  const rows: string[] = [];
  let regressions = 0;

  for (const metric of collect(after).values()) {
    const previous = old.get(metric.name);
    if (!previous) continue;
    const change = previous.value === 0 ? 0 : ((metric.value - previous.value) / previous.value) * 100;
    const worse = metric.better === "lower" ? change > 0 : change < 0;
    const significant = Math.abs(metric.value - previous.value) >= metric.floor && Math.abs(change) >= threshold;
    const verdict = !significant ? "" : worse ? "worse" : "better";
    if (verdict === "worse") regressions++;
    rows.push(`| ${metric.name} | ${previous.value} | ${metric.value} | ${change > 0 ? "+" : ""}${change.toFixed(1)}% | ${verdict} |`);
  }

  console.log(`Before: ${before.environment.commit} (${before.environment.date})`);
  console.log(`After:  ${after.environment.commit} (${after.environment.date})`);
  if (before.environment.cpu !== after.environment.cpu || before.environment.cores !== after.environment.cores) {
    console.log("\nThese runs come from different machines, so differences say as much about the hardware as the code.");
  }
  console.log(["", "| Metric | Before | After | Change | |", "| --- | --: | --: | --: | --- |", ...rows].join("\n"));
  console.log(`\n${regressions} metric${regressions === 1 ? "" : "s"} worse by more than ${threshold}%.`);
  return regressions;
}
