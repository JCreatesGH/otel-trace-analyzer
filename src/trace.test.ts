import { describe, it, expect } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSpans, buildTree, buildForest } from "./model";
import { selfTime, slowestSpan, criticalPath, findNPlusOne, byService, analyze } from "./analyze";
import { run, formatReport } from "./cli";

// root(0..100): handler(0..95) -> [db(5..15), render(20..90)], plus auth(0..3)
const SPANS = loadSpans([
  { spanId: "root", name: "GET /orders", start: 0, end: 100 },
  { spanId: "auth", parentSpanId: "root", name: "auth", start: 0, end: 3 },
  { spanId: "handler", parentSpanId: "root", name: "handler", start: 3, end: 95 },
  { spanId: "db", parentSpanId: "handler", name: "db.query", start: 5, end: 15 },
  { spanId: "render", parentSpanId: "handler", name: "render", start: 20, end: 90 },
]);

describe("buildTree", () => {
  it("nests spans by parent", () => {
    const root = buildTree(SPANS)!;
    expect(root.spanId).toBe("root");
    expect(root.children.map((c) => c.spanId).sort()).toEqual(["auth", "handler"]);
  });
});

describe("selfTime", () => {
  it("excludes time covered by children (no double counting)", () => {
    const root = buildTree(SPANS)!;
    const handler = root.children.find((c) => c.spanId === "handler")!;
    // handler 92ms, children cover db(10) + render(70) = 80 -> self 12
    expect(selfTime(handler)).toBe(12);
  });
});

describe("slowestSpan", () => {
  it("finds the span with the most exclusive time", () => {
    const { span, selfTime: st } = slowestSpan(buildTree(SPANS)!);
    expect(span.name).toBe("render");   // 70ms self
    expect(st).toBe(70);
  });
});

describe("criticalPath", () => {
  it("follows the latest-ending child to the finish", () => {
    const path = criticalPath(buildTree(SPANS)!).map((s) => s.name);
    expect(path).toEqual(["GET /orders", "handler", "render"]);
  });
});

describe("findNPlusOne", () => {
  it("detects repeated same-named children", () => {
    const spans = loadSpans([
      { spanId: "r", name: "list users", start: 0, end: 100 },
      ...Array.from({ length: 6 }, (_, i) => ({
        spanId: "q" + i, parentSpanId: "r", name: "SELECT user", start: i * 5, end: i * 5 + 3,
      })),
    ]);
    const n = findNPlusOne(buildTree(spans)!);
    expect(n[0]).toMatchObject({ childName: "SELECT user", count: 6 });
  });
});

describe("analyze", () => {
  it("returns a full summary", () => {
    const a = analyze(SPANS)!;
    expect(a.total).toBe(100);
    expect(a.spanCount).toBe(5);
    expect(a.criticalPath).toEqual(["GET /orders", "handler", "render"]);
    expect(a.slowest.name).toBe("render");
  });

  it("converts OTLP nano timestamps", () => {
    const spans = loadSpans({ spans: [
      { spanId: "x", name: "op", startTimeUnixNano: "1000000", endTimeUnixNano: "6000000" },
    ]});
    expect(spans[0].end - spans[0].start).toBe(5);   // 5ms
  });
});

describe("buildForest (multi-root)", () => {
  it("keeps every root tree instead of dropping all but the widest", () => {
    const spans = loadSpans([
      { spanId: "a", name: "trace A", start: 0, end: 50 },
      { spanId: "a1", parentSpanId: "a", name: "step", start: 0, end: 40 },
      { spanId: "b", name: "trace B", start: 0, end: 100 },
    ]);
    const forest = buildForest(spans);
    expect(forest.map((r) => r.spanId)).toEqual(["b", "a"]);   // widest first
    expect(analyze(spans)!.rootCount).toBe(2);
    expect(analyze(spans)!.spanCount).toBe(3);                 // no spans lost
  });
});

describe("byService", () => {
  it("sums self-time per service (using the span service field)", () => {
    const spans = loadSpans([
      { spanId: "r", name: "GET /", start: 0, end: 100, service: "gateway" },
      { spanId: "d", parentSpanId: "r", name: "query", start: 10, end: 90, service: "db" },
    ]);
    const svc = byService(buildTree(spans)!);
    expect(svc).toEqual({ gateway: 20, db: 80 });   // root self 20, db self 80
    expect(analyze(spans)!.byService).toEqual({ gateway: 20, db: 80 });
  });
});

describe("cli", () => {
  function write(name: string, obj: unknown): string {
    const p = join(tmpdir(), `otel-${process.pid}-${name}`);
    writeFileSync(p, JSON.stringify(obj));
    return p;
  }

  it("formats a human report", () => {
    const a = analyze(SPANS)!;
    const lines = formatReport(a).join("\n");
    expect(lines).toContain("Critical path: GET /orders → handler → render");
    expect(lines).toContain("Slowest (self): render");
  });

  it("reads a trace file and prints a report", () => {
    const p = write("ok.json", [
      { spanId: "r", name: "GET /", start: 0, end: 100 },
      ...Array.from({ length: 6 }, (_, i) => ({ spanId: "q" + i, parentSpanId: "r", name: "SELECT", start: i, end: i + 1 })),
    ]);
    const r = run([p]);
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toContain("N+1 suspects");
    rmSync(p);
  });

  it("--json emits the analysis, --check gates on N+1", () => {
    const p = write("np.json", [
      { spanId: "r", name: "GET /", start: 0, end: 100 },
      ...Array.from({ length: 6 }, (_, i) => ({ spanId: "q" + i, parentSpanId: "r", name: "SELECT", start: i, end: i + 1 })),
    ]);
    expect(JSON.parse(run([p, "--json"]).out[0]).spanCount).toBe(7);
    expect(run([p, "--check"]).code).toBe(1);     // N+1 present -> fail
    rmSync(p);
  });

  it("missing file and no args exit 2", () => {
    expect(run(["/no/such/trace.json"]).code).toBe(2);
    expect(run([]).code).toBe(2);
  });
});
