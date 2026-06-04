export { loadSpans, buildTree } from "./model.js";
export type { Span, SpanNode } from "./model.js";
export { flatten, totalDuration, selfTime, slowestSpan, criticalPath, findNPlusOne, analyze } from "./analyze.js";
export type { NPlusOne } from "./analyze.js";
