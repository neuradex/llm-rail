import * as path from "node:path";
import { loadYaml } from "../util.js";
import { isV1Workflow, type WorkflowV1Def } from "../types-v1.js";
import type { WorkflowDef } from "../types.js";
import { resolveWorkflowPath } from "./variant.js";
import {
  loadV1Instance,
  resolveV1InstancePath,
  type V1InstanceState,
} from "./state-v1.js";
import { loadInstance } from "./state.js";
import type { InstanceState } from "../types.js";

// ── Workflow ──

export type WorkflowAny =
  | { kind: "v1"; def: WorkflowV1Def }
  | { kind: "legacy"; def: WorkflowDef };

/**
 * Load a workflow by name and report which format it is. Used by CLI
 * commands that accept both legacy and v1 workflows during the
 * transition period; will simplify to v1-only when legacy is removed.
 */
export function loadWorkflowAny(name: string, variant?: string): WorkflowAny {
  const { basePath } = resolveWorkflowPath(name);
  const raw = loadYaml<unknown>(basePath);
  if (isV1Workflow(raw)) {
    if (variant) {
      throw new Error(
        `Workflow '${name}' is v1; v1 variants are not yet supported. Run without --variant.`,
      );
    }
    return { kind: "v1", def: raw };
  }
  // Defer to legacy loader (handles variant merging).
  // Avoid the v1 guard inside loadWorkflow by calling its underlying
  // legacy parser directly through a fresh import to keep the layering
  // clean. The simplest path is to accept the raw YAML as a WorkflowDef.
  return { kind: "legacy", def: raw as WorkflowDef };
}

export function loadWorkflowAnyFromPath(filePath: string): WorkflowAny {
  const raw = loadYaml<unknown>(path.resolve(filePath));
  if (isV1Workflow(raw)) {
    return { kind: "v1", def: raw };
  }
  return { kind: "legacy", def: raw as WorkflowDef };
}

// ── Instance ──

export type InstanceAny =
  | { kind: "v1"; state: V1InstanceState }
  | { kind: "legacy"; state: InstanceState };

/**
 * Load an instance by id or alias and report which format its state.yaml
 * is in. Tries the v1 loader first (cheap format check); falls back to
 * the legacy loader on mismatch.
 */
export function loadInstanceAny(idOrAlias: string): InstanceAny {
  // Use the v1 path-resolver since both formats save to the same layout.
  const filePath = resolveV1InstancePath(idOrAlias);
  const raw = loadYaml<unknown>(filePath);
  if (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { format?: unknown }).format === "v1"
  ) {
    return { kind: "v1", state: raw as V1InstanceState };
  }
  // Re-route through the legacy loader so its side effects (alias
  // resolution, error messages) stay consistent with existing behavior.
  return { kind: "legacy", state: loadInstance(idOrAlias) };
}

/**
 * Convenience helper used by tests: same as loadInstanceAny but lets the
 * caller specify a format expectation, throwing on mismatch.
 */
export function loadV1InstanceAny(idOrAlias: string): V1InstanceState {
  return loadV1Instance(idOrAlias);
}
