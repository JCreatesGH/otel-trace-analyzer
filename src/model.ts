// A span and helpers to load OpenTelemetry-style traces.
export interface Span {
  spanId: string;
  parentSpanId?: string;
  name: string;
  start: number;     // ms (or any consistent unit)
  end: number;
  service?: string;
  status?: "OK" | "ERROR" | "UNSET";   // normalized span status
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
      status: statusOf(s),
    };
  });
}

function toMs(nano: any): number {
  return nano ? Number(nano) / 1e6 : 0;
}

/** Normalize an OTel span status from the many shapes in the wild:
 * `status.code` (numeric 2=ERROR, or STATUS_CODE_ERROR / "ERROR"), an `error`
 * flag, or an `http.status_code` >= 500. */
function statusOf(s: any): "OK" | "ERROR" | "UNSET" | undefined {
  const raw = s.status?.code ?? s.statusCode ?? (typeof s.status === "string" ? s.status : undefined);
  if (typeof raw === "number") {
    if (raw === 2) return "ERROR";
    if (raw === 1) return "OK";
    if (raw === 0) return "UNSET";
  }
  if (typeof raw === "string") {
    const u = raw.toUpperCase();
    if (u.includes("ERROR")) return "ERROR";
    if (u.includes("OK")) return "OK";
    if (u.includes("UNSET")) return "UNSET";
  }
  if (s.error === true) return "ERROR";
  const http = Number(s.attributes?.["http.status_code"] ??
    s.attributes?.["http.response.status_code"] ?? s["http.status_code"]);
  if (Number.isFinite(http) && http >= 500) return "ERROR";
  return undefined;
}

/** Build every root tree (a span whose parent is absent is a root), widest first.
 * Handles forests — multi-root traces no longer lose all-but-one subtree. */
export function buildForest(spans: Span[]): SpanNode[] {
  const nodes = new Map<string, SpanNode>();
  for (const s of spans) nodes.set(s.spanId, { ...s, children: [], duration: s.end - s.start });
  const roots: SpanNode[] = [];
  for (const n of nodes.values()) {
    if (n.parentSpanId && nodes.has(n.parentSpanId)) nodes.get(n.parentSpanId)!.children.push(n);
    else roots.push(n);
  }
  for (const n of nodes.values()) n.children.sort((a, b) => a.start - b.start);
  return roots.sort((a, b) => b.duration - a.duration);
}

/** The primary (widest) root tree, or null. */
export function buildTree(spans: Span[]): SpanNode | null {
  return buildForest(spans)[0] ?? null;
}
