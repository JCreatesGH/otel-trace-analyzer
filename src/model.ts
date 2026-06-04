// A span and helpers to load OpenTelemetry-style traces.
export interface Span {
  spanId: string;
  parentSpanId?: string;
  name: string;
  start: number;     // ms (or any consistent unit)
  end: number;
  service?: string;
}

export interface SpanNode extends Span {
  children: SpanNode[];
  duration: number;
}

/** Accepts a flat array of spans, or OTLP-ish { spans: [...] }. Times may be
 * given as start/end, or startTimeUnixNano/endTimeUnixNano (converted to ms). */
export function loadSpans(input: any): Span[] {
  const arr: any[] = Array.isArray(input) ? input : input.spans ?? [];
  return arr.map((s) => {
    const start = s.start ?? toMs(s.startTimeUnixNano);
    const end = s.end ?? toMs(s.endTimeUnixNano);
    return {
      spanId: String(s.spanId ?? s.id),
      parentSpanId: s.parentSpanId ? String(s.parentSpanId) : undefined,
      name: s.name ?? "span",
      start, end,
      service: s.service ?? s.resource?.service?.name,
    };
  });
}

function toMs(nano: any): number {
  return nano ? Number(nano) / 1e6 : 0;
}

export function buildTree(spans: Span[]): SpanNode | null {
  const nodes = new Map<string, SpanNode>();
  for (const s of spans) nodes.set(s.spanId, { ...s, children: [], duration: s.end - s.start });
  let root: SpanNode | null = null;
  for (const n of nodes.values()) {
    if (n.parentSpanId && nodes.has(n.parentSpanId)) nodes.get(n.parentSpanId)!.children.push(n);
    else root = root && root.duration >= n.duration ? root : n;   // pick widest as root if multiple
  }
  for (const n of nodes.values()) n.children.sort((a, b) => a.start - b.start);
  return root;
}
