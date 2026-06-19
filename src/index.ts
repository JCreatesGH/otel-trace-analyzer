export { loadSpans, buildTree, buildForest } from "./model.js";
export type { Span, SpanNode } from "./model.js";
export { flatten, totalDuration, selfTime, slowestSpan, criticalPath, findNPlusOne, byService, errorSpans, analyze } from "./analyze.js";
export type { NPlusOne, ErrorSpan } from "./analyze.js";
export { run, formatReport } from "./cli.js";
