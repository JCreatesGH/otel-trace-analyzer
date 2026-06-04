import { describe, it, expect } from "vitest";
import { loadSpans, buildTree } from "./model";
import { selfTime, slowestSpan, criticalPath, findNPlusOne, analyze } from "./analyze";

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
