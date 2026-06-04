import { Span, SpanNode, buildTree } from "./model.js";

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

export function analyze(spans: Span[]) {
  const root = buildTree(spans);
  if (!root) return null;
  const slow = slowestSpan(root);
  return {
    total: totalDuration(root),
    spanCount: flatten(root).length,
    criticalPath: criticalPath(root).map((s) => s.name),
    slowest: { name: slow.span.name, selfTime: slow.selfTime },
    nPlusOne: findNPlusOne(root),
  };
}
