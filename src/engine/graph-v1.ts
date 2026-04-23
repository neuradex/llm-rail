import type { AssertionRule } from "../types.js";
import {
  isAgenticStep,
  isCallStep,
  isProgrammaticStep,
  isRouterStep,
  type ContextInValue,
  type SchemaDef,
  type SchemaRef,
  type V1StepDef,
  type WhenExpr,
  type WorkflowV1Def,
} from "../types-v1.js";

// ── Public shapes ──

export interface GraphExport {
  format: "v1";
  name: string;
  version?: string;
  description?: string;
  input: SchemaRef;
  output: SchemaRef;
  max_depth?: number;
  schemas: Record<string, SchemaDef>;
  nodes: GraphNode[];
  control_edges: ControlEdge[];
  /**
   * Step-to-step data dependencies (context_in / call.inputs references of
   * the form `{step.field}`). Workflow input references (`{{name}}`) live
   * in `input_refs` instead to avoid mixing two kinds of source.
   */
  data_edges: DataEdge[];
  /**
   * Workflow-input references. Renderers can draw them as edges from a
   * synthetic "Input" box to each consumer step.
   */
  input_refs: InputRef[];
}

export interface GraphNode {
  id: string;
  type: V1StepDef["type"];
  description?: string;
  /** agentic */
  instruction?: string;
  required_output?: SchemaRef;
  /** programmatic */
  actions?: { name: string; description: string; kind: "js" | "shell" }[];
  /** router */
  cases?: { index: number; when_summary: string; goto: string }[];
  default?: string;
  max_iterations?: number;
  /** call */
  workflow?: string;
  inputs?: Record<string, string>;
}

export type ControlEdgeKind =
  | "sequential"
  | "router-case"
  | "router-default"
  | "call-entry";

export interface ControlEdge {
  from: string;
  to: string;
  kind: ControlEdgeKind;
  /** router-case only */
  case_index?: number;
  when_summary?: string;
  /** router-case / router-default: true if `to` is at or before `from`. */
  backward?: boolean;
  /** call-entry: the `to` is an external workflow name, not a local step id. */
  external?: boolean;
}

export interface DataEdge {
  from_step: string;
  /** The first segment of the referenced path. Kept for simple consumers. */
  from_field: string;
  /** The full dotted path as declared in the reference (e.g. "stats.count"). */
  from_path: string;
  to_step: string;
  /**
   * The consumer key. For context_in this is the local alias; for
   * call-input it is the raw key on the child workflow's input (no
   * "inputs." prefix — use `via` to disambiguate).
   */
  to_key: string;
  via: "context_in" | "call-input";
  has_default: boolean;
}

export interface InputRef {
  to_step: string;
  to_key: string;
  /** First segment of the workflow-input path. */
  field: string;
  /** Full dotted path, e.g. "user.name". */
  path: string;
  via: "context_in" | "call-input";
  has_default: boolean;
}

// ── Public API ──

/**
 * Export a v1 workflow as a structured graph.
 *
 * Intended as the consumer-facing API for visualizers and editors: consumers
 * never have to parse YAML or regex out goto targets. Four kinds of edges
 * are surfaced:
 *
 *   - `control_edges` — where execution can go (sequential / router /
 *     call entry).
 *   - `data_edges` — step-to-step data dependencies via context_in and
 *     call.inputs.
 *   - `input_refs` — references to workflow-level input fields (`{{name}}`).
 *     Rendered as edges from a synthetic "Input" box in diagrams.
 *
 * `data_edges` and `input_refs` are intentionally kept separate: they
 * describe different kinds of source (a prior step's output vs the
 * workflow's input shape), and renderers usually want to style them
 * differently.
 */
export function exportGraph(def: WorkflowV1Def): GraphExport {
  const stepOrder = new Map<string, number>();
  def.steps.forEach((s, i) => stepOrder.set(s.id, i));

  const nodes: GraphNode[] = def.steps.map((s) => buildNode(s));

  const control_edges: ControlEdge[] = [];
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const next = def.steps[i + 1];

    if (isRouterStep(step)) {
      step.cases.forEach((c, idx) => {
        control_edges.push({
          from: step.id,
          to: c.goto,
          kind: "router-case",
          case_index: idx,
          when_summary: summarizeWhen(c.when),
          backward: isBackward(step.id, c.goto, stepOrder),
        });
      });
      if (step.default) {
        control_edges.push({
          from: step.id,
          to: step.default,
          kind: "router-default",
          backward: isBackward(step.id, step.default, stepOrder),
        });
      }
      // A router never falls through to the next-in-order step, so we do
      // not emit a sequential edge from it.
      continue;
    }

    if (isCallStep(step)) {
      control_edges.push({
        from: step.id,
        to: step.workflow,
        kind: "call-entry",
        external: true,
      });
      if (next) {
        control_edges.push({ from: step.id, to: next.id, kind: "sequential" });
      }
      continue;
    }

    if (next) {
      control_edges.push({ from: step.id, to: next.id, kind: "sequential" });
    }
  }

  const data_edges: DataEdge[] = [];
  const input_refs: InputRef[] = [];
  for (const step of def.steps) {
    // context_in on agentic/programmatic/router
    const contextIn =
      isAgenticStep(step) || isProgrammaticStep(step) || isRouterStep(step)
        ? step.context_in
        : undefined;
    if (contextIn) {
      for (const [key, value] of Object.entries(contextIn)) {
        appendReference(step.id, key, value, "context_in", data_edges, input_refs);
      }
    }
    // call.inputs
    if (isCallStep(step)) {
      for (const [key, tmpl] of Object.entries(step.inputs)) {
        appendReference(step.id, key, tmpl, "call-input", data_edges, input_refs);
      }
    }
  }

  const graph: GraphExport = {
    format: "v1",
    name: def.name,
    schemas: def.schemas,
    input: def.input,
    output: def.output,
    nodes,
    control_edges,
    data_edges,
    input_refs,
  };
  if (def.version) graph.version = def.version;
  if (def.description) graph.description = def.description;
  if (def.max_depth !== undefined) graph.max_depth = def.max_depth;
  return graph;
}

// ── when_summary renderer ──

/**
 * Render a WhenExpr as a human-readable boolean expression. The format
 * is stable and designed for display, not for round-trip parsing.
 */
export function summarizeWhen(w: WhenExpr): string {
  if (Array.isArray(w)) {
    if (w.length === 0) return "(true)";
    return w.map((x) => summarizeWhen(x as WhenExpr)).join(" AND ");
  }
  if (isAllExpr(w)) {
    return "(" + w.all.map((x) => summarizeWhen(x)).join(" AND ") + ")";
  }
  if (isAnyExpr(w)) {
    return "(" + w.any.map((x) => summarizeWhen(x)).join(" OR ") + ")";
  }
  if (isNotExpr(w)) {
    return "NOT " + summarizeWhen(w.not);
  }
  const rule = w as AssertionRule;
  const val = rule.value === undefined ? "" : ` ${formatValue(rule.value)}`;
  return `${rule.field} ${rule.op}${val}`;
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function isAllExpr(w: WhenExpr): w is { all: WhenExpr[] } {
  return typeof w === "object" && w !== null && !Array.isArray(w) && "all" in w;
}
function isAnyExpr(w: WhenExpr): w is { any: WhenExpr[] } {
  return typeof w === "object" && w !== null && !Array.isArray(w) && "any" in w;
}
function isNotExpr(w: WhenExpr): w is { not: WhenExpr } {
  return typeof w === "object" && w !== null && !Array.isArray(w) && "not" in w;
}

// ── Helpers ──

function buildNode(step: V1StepDef): GraphNode {
  const base: GraphNode = { id: step.id, type: step.type };
  if (step.description) base.description = step.description;

  if (isAgenticStep(step)) {
    base.instruction = step.instruction;
    base.required_output = step.required_output;
    return base;
  }
  if (isProgrammaticStep(step)) {
    base.actions = step.actions.map((a) => ({
      name: a.name,
      description: a.description,
      kind: typeof a.js === "string" && a.js.trim() !== "" ? "js" : "shell",
    }));
    if (step.required_output) base.required_output = step.required_output;
    return base;
  }
  if (isRouterStep(step)) {
    base.cases = step.cases.map((c, i) => ({
      index: i,
      when_summary: summarizeWhen(c.when),
      goto: c.goto,
    }));
    base.default = step.default;
    if (step.max_iterations !== undefined) base.max_iterations = step.max_iterations;
    return base;
  }
  if (isCallStep(step)) {
    base.workflow = step.workflow;
    base.inputs = { ...step.inputs };
    return base;
  }
  return base;
}

function isBackward(
  fromId: string,
  toId: string,
  order: Map<string, number>,
): boolean {
  const f = order.get(fromId);
  const t = order.get(toId);
  if (f === undefined || t === undefined) return false;
  return t <= f;
}

/**
 * Parse a single context_in / call.inputs entry and route it into the
 * correct bucket: step-ref → data_edges, workflow-input-ref → input_refs.
 * Non-references and malformed templates are silently skipped (compile
 * reports those separately).
 */
function appendReference(
  consumerId: string,
  key: string,
  value: ContextInValue | string,
  via: "context_in" | "call-input",
  dataEdges: DataEdge[],
  inputRefs: InputRef[],
): void {
  const template = typeof value === "string" ? value : value.from;
  const hasDefault = typeof value !== "string" && "default" in value;

  const stepMatch = template.match(/^\{([\w-]+)\.([\w.-]+)\}$/);
  if (stepMatch) {
    const fullPath = stepMatch[2];
    dataEdges.push({
      from_step: stepMatch[1],
      from_field: fullPath.split(".")[0],
      from_path: fullPath,
      to_step: consumerId,
      to_key: key,
      via,
      has_default: hasDefault,
    });
    return;
  }

  const inputMatch = template.match(/^\{\{([\w.-]+)\}\}$/);
  if (inputMatch) {
    const fullPath = inputMatch[1];
    inputRefs.push({
      to_step: consumerId,
      to_key: key,
      field: fullPath.split(".")[0],
      path: fullPath,
      via,
      has_default: hasDefault,
    });
    return;
  }

  // Unrecognized template shape — caller's static checks will complain.
}
