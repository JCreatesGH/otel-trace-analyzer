#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadSpans } from "./model.js";
import { analyze } from "./analyze.js";

const USAGE = `otel-trace-analyzer — critical path, slowest span, N+1, per-service time

Usage:
  otel-trace-analyzer <trace.json> [--json] [--check]

  <trace.json>  a flat array of spans or an OTLP-ish { spans: [...] }
  --json        emit the full analysis as JSON
  --check       exit 1 if any N+1 pattern is detected (CI perf gate)`;

type Analysis = NonNullable<ReturnType<typeof analyze>>;

export function formatReport(a: Analysis): string[] {
  const lines = [
    `Total: ${a.total.toFixed(2)}ms across ${a.spanCount} spans` +
      (a.rootCount > 1 ? ` (${a.rootCount} root traces)` : ""),
    `Critical path: ${a.criticalPath.join(" → ")}`,
    `Slowest (self): ${a.slowest.name} (${a.slowest.selfTime.toFixed(2)}ms)`,
  ];
  const svc = Object.entries(a.byService).sort((x, y) => y[1] - x[1]);
  if (svc.length) {
    lines.push("By service: " + svc.slice(0, 5).map(([s, t]) => `${s} ${t.toFixed(1)}ms`).join(", "));
  }
  if (a.nPlusOne.length) {
    lines.push(`N+1 suspects (${a.nPlusOne.length}):`);
    for (const n of a.nPlusOne.slice(0, 5)) lines.push(`  ${n.parent} → ${n.childName} ×${n.count}`);
  }
  return lines;
}

export function run(argv: string[]): { code: number; out: string[]; err: string[] } {
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
    return { code: argv.length ? 0 : 2, out: argv.length ? [USAGE] : [], err: argv.length ? [] : [USAGE] };
  }
  const file = argv.find((a) => !a.startsWith("-"));
  if (!file) return { code: 2, out: [], err: [USAGE] };

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    return { code: 2, out: [], err: [`otel-trace-analyzer: cannot read ${file}: ${(e as Error).message}`] };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { code: 2, out: [], err: [`otel-trace-analyzer: invalid JSON in ${file}`] };
  }

  const a = analyze(loadSpans(data));
  if (!a) return { code: 2, out: [], err: ["otel-trace-analyzer: no spans found"] };
  if (argv.includes("--json")) return { code: 0, out: [JSON.stringify(a, null, 2)], err: [] };
  const code = argv.includes("--check") && a.nPlusOne.length ? 1 : 0;
  return { code, out: formatReport(a), err: [] };
}

if (process.argv[1] && /cli\.js$/.test(process.argv[1])) {
  const { code, out, err } = run(process.argv.slice(2));
  out.forEach((l) => console.log(l));
  err.forEach((l) => console.error(l));
  process.exit(code);
}
