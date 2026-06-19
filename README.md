# otel-trace-analyzer

[![CI](https://github.com/JCreatesGH/otel-trace-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/JCreatesGH/otel-trace-analyzer/actions)
[![TypeScript](https://img.shields.io/badge/types-included-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Find where a request's latency actually went — or why it failed. `otel-trace-analyzer` loads an OpenTelemetry trace and computes the **critical path**, the **slowest span by self-time**, **per-service time**, **N+1 patterns**, and the **error spans** — the things you look for first when a trace is slow or broken.

![screenshot](assets/screenshot.png)

## CLI

```bash
otel-trace-analyzer trace.json            # human report
otel-trace-analyzer trace.json --json     # machine-readable
otel-trace-analyzer trace.json --check    # exit 1 if an N+1 pattern is found (CI gate)
# Total: 100.00ms across 5 spans
# Critical path: GET /orders → handler → render
# Slowest (self): render (70.00ms)
# By service: db 80.0ms, gateway 20.0ms
```

## Use it as a library

```ts
import { loadSpans, analyze } from "otel-trace-analyzer";

const spans = loadSpans(otlpJson);     // flat array or { spans: [...] }, ms or OTLP nanos
const a = analyze(spans);

a.total          // end-to-end duration
a.criticalPath   // ["GET /orders", "handler", "render"]
a.slowest        // { name: "render", selfTime: 70 }
a.byService      // { gateway: 20, db: 80 }  -- self-time per service
a.nPlusOne       // [{ parent: "handler", childName: "SELECT user", count: 6 }]
a.errors         // [{ name: "charge", service: "payments" }]  -- spans with status ERROR
a.rootCount      // number of root traces in the input
```

## What it computes

- **Self time** — a span's exclusive time, *merging overlapping children* so concurrent work isn't double-counted. This is what makes "slowest span" actually correct.
- **Per-service time** — total self-time grouped by the span's `service`, so you can see which service owns the latency.
- **Critical path** — from the root, follow the latest-ending child to the finish; that chain is what determines end-to-end latency.
- **N+1 detection** — a parent with many identically-named children (the classic repeated-DB-call smell).
- **Error spans** — `errorSpans()` surfaces failing operations, normalizing the many status shapes (`status.code` numeric `2` or `STATUS_CODE_ERROR`/`"ERROR"`, an `error` flag, or an `http.status_code` ≥ 500). `--check` now exits `1` on an N+1 pattern *or* an error span, so it gates CI on a broken trace too.
- **Forests** — multi-root traces are all retained (`buildForest`); counts and per-service totals cover every tree, not just the widest.

Input is tolerant: a flat list of spans with `start`/`end`, or OTLP-style `startTimeUnixNano`/`endTimeUnixNano` (auto-converted to ms).

## Development

```bash
npm install && npm test    # 16 tests
npm run build              # tsc, clean
```

## License

MIT
