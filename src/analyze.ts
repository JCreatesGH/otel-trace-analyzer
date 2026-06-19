import { Span, SpanNode, buildTree, buildForest } from "./model.js";

export function flatten(node: SpanNode): SpanNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

export function totalDuration(root: SpanNode): number {
  return root.duration;
}

/** Self (exclusive) time = span duration minus time covered by its children. */
export function selfTime(node: SpanNode): number {
  // merge child intervals so overlapping children aren't double-counted
  const intervals = node.children.map((c) => [c.start, c.end] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0, curStart = -1, curEnd = -1;
  for (const [s, e] of intervals) {
    if (s > curEnd) { covered += curEnd - curStart > 0 ? curEnd - curStart : 0; curStart = s; curEnd = e; }
    else curEnd = Math.max(curEnd, e);
  }
  if (curEnd > curStart) covered += curEnd - curStart;
  return Math.max(0, node.duration - covered);
}

export function slowestSpan(root: SpanNode): { span: SpanNode; selfTime: number } {
  let best = root, bestSelf = -1;
  for (const n of flatten(root)) {
    const st = selfTime(n);
    if (st > bestSelf) { bestSelf = st; best = n; }
  }
  return { span: best, selfTime: bestSelf };
}

/** Critical path: from the root, repeatedly follow the child that ends latest. */
export function criticalPath(root: SpanNode): SpanNode[] {
  const path = [root];
  let cur = root;
  while (cur.children.length) {
    cur = cur.children.reduce((a, b) => (b.end > a.end ? b : a));
    path.push(cur);
  }
  return path;
}

export interface NPlusOne { parent: string; childName: string; count: number; }

/** Detect N+1 patterns: a parent with many same-named children (e.g. repeated DB calls). */
export function findNPlusOne(root: SpanNode, threshold = 5): NPlusOne[] {
  const out: NPlusOne[] = [];
  for (const n of flatten(root)) {
    const counts = new Map<string, number>();
    for (const c of n.children) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    for (const [name, count] of counts) {
      if (count >= threshold) out.push({ parent: n.name, childName: name, count });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

export interface ErrorSpan { name: string; service?: string; }

/** Spans whose normalized status is ERROR — the failing operations in a trace. */
export function errorSpans(root: SpanNode): ErrorSpan[] {
  return flatten(root)
    .filter((n) => n.status === "ERROR")
    .map((n) => ({ name: n.name, service: n.service }));
}

/** Total *self* time per service across a tree (uses the span `service` field). */
export function byService(root: SpanNode): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of flatten(root)) {
    const svc = n.service ?? "unknown";
    out[svc] = (out[svc] ?? 0) + selfTime(n);
  }
  return out;
}

export function analyze(spans: Span[]) {
  const forest = buildForest(spans);
  if (!forest.length) return null;
  const root = forest[0];                      // widest tree drives critical path
  const all = forest.flatMap(flatten);         // but counts/services span the whole forest

  let slowName = root.name, slowSelf = -1;
  const services: Record<string, number> = {};
  const errors: { name: string; service?: string }[] = [];
  for (const n of all) {
    const st = selfTime(n);
    if (st > slowSelf) { slowSelf = st; slowName = n.name; }
    const svc = n.service ?? "unknown";
    services[svc] = (services[svc] ?? 0) + st;
    if (n.status === "ERROR") errors.push({ name: n.name, service: n.service });
  }

  return {
    total: totalDuration(root),
    rootCount: forest.length,
    spanCount: all.length,
    criticalPath: criticalPath(root).map((s) => s.name),
    slowest: { name: slowName, selfTime: slowSelf },
    nPlusOne: forest.flatMap((r) => findNPlusOne(r)).sort((a, b) => b.count - a.count),
    byService: services,
    errors,
  };
}
