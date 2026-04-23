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
  data_edges: DataEdge[];
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
  cases?: { index: number; when_summary: string; goto: string; backward: boolean }[];
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
  /** router-case / router-default: true if to is at or before from in step order. */
  backward?: boolean;
  /** call-entry: the `to` is an external workflow name, not a local step id. */
  external?: boolean;
}

export interface DataEdge {
  from_step: string;
  from_field: string;
  to_step: string;
  to_key: string;
  via: "context_in" | "call-input";
  has_default: boolean;
}

// ── Public API ──

/**
 * Export a v1 workflow as a structured graph.
 *
 * Consumers (visualizers, Loom-style editors) consume this in place of
 * parsing the YAML. Control edges describe where execution can go;
 * data edges describe cross-step data flow driven by context_in /
 * call.inputs. Workflow-level input references (`{{name}}`) are not
 * represented as data edges (they all originate from the same virtual
 * source), but the raw input/output schema names are preserved.
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
  for (const step of def.steps) {
    // context_in on agentic/programmatic/router
    const contextIn =
      isAgenticStep(step) || isProgrammaticStep(step) || isRouterStep(step)
        ? step.context_in
        : undefined;
    if (contextIn) {
      for (const [key, value] of Object.entries(contextIn)) {
        appendDataEdgeFromContextEntry(step.id, key, value, data_edges, "context_in");
      }
    }
    // call.inputs
    if (isCallStep(step)) {
      for (const [key, tmpl] of Object.entries(step.inputs)) {
        appendDataEdgeFromContextEntry(
          step.id,
          `inputs.${key}`,
          tmpl,
          data_edges,
          "call-input",
        );
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
      backward: false, // filled in by caller context in control_edges, not here
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

function appendDataEdgeFromContextEntry(
  consumerId: string,
  key: string,
  value: ContextInValue | string,
  out: DataEdge[],
  via: DataEdge["via"],
): void {
  const template = typeof value === "string" ? value : value.from;
  const hasDefault = typeof value !== "string" && "default" in value;
  const m = template.match(/^\{([\w-]+)\.([\w.-]+)\}$/);
  if (!m) return; // workflow input refs and non-refs are skipped
  const fromStep = m[1];
  const fromField = m[2].split(".")[0];
  out.push({
    from_step: fromStep,
    from_field: fromField,
    to_step: consumerId,
    to_key: key,
    via,
    has_default: hasDefault,
  });
}
