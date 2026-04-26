import * as path from "node:path";
import { loadYaml } from "../util.js";
import { isV1Workflow, type WorkflowV1Def } from "../types-v1.js";
import { resolveWorkflowPath } from "./variant.js";
import {
  loadV1Instance,
  resolveV1InstancePath,
  type V1InstanceState,
} from "./state-v1.js";

// ── Workflow ──

export interface WorkflowAnyV1 {
  kind: "v1";
  def: WorkflowV1Def;
}

/**
 * Load a workflow by name. v1 only — 1.0.0 dropped legacy format support
 * at runtime. Use `lrail wf <name> migrate` to convert pre-1.0 files.
 */
export function loadWorkflowAny(name: string, variant?: string): WorkflowAnyV1 {
  const { basePath } = resolveWorkflowPath(name);
  const raw = loadYaml<unknown>(basePath);
  if (!isV1Workflow(raw)) {
    throw legacyWorkflowError(name, basePath);
  }
  if (variant) {
    throw new Error(
      `Workflow '${name}' is v1; v1 variants are not yet supported. Run without --variant.`,
    );
  }
  return { kind: "v1", def: raw };
}

export function loadWorkflowAnyFromPath(filePath: string): WorkflowAnyV1 {
  const resolved = path.resolve(filePath);
  const raw = loadYaml<unknown>(resolved);
  if (!isV1Workflow(raw)) {
    throw legacyWorkflowError(path.basename(resolved), resolved);
  }
  return { kind: "v1", def: raw };
}

// ── Instance ──

export interface InstanceAnyV1 {
  kind: "v1";
  state: V1InstanceState;
}

/**
 * Load an instance by id or alias. v1 only at runtime; legacy state.yaml
 * files surface a clear migration error.
 */
export function loadInstanceAny(idOrAlias: string): InstanceAnyV1 {
  const filePath = resolveV1InstancePath(idOrAlias);
  const raw = loadYaml<unknown>(filePath);
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { format?: unknown }).format !== "v1"
  ) {
    throw legacyInstanceError(idOrAlias, filePath);
  }
  return { kind: "v1", state: raw as V1InstanceState };
}

export function loadV1InstanceAny(idOrAlias: string): V1InstanceState {
  return loadV1Instance(idOrAlias);
}

// ── Errors ──

function legacyWorkflowError(name: string, filePath: string): Error {
  return new Error(
    [
      `Workflow '${name}' at ${filePath} uses the legacy (pre-1.0) format.`,
      `lrail 1.0.0 only runs v1 workflows.`,
      `Convert it once with:`,
      `  lrail wf ${name} migrate --path ${filePath}`,
      `then review the generated *.migrated.yml file before using.`,
    ].join("\n"),
  );
}

function legacyInstanceError(idOrAlias: string, filePath: string): Error {
  return new Error(
    [
      `Instance '${idOrAlias}' (${filePath}) was created against a legacy workflow.`,
      `lrail 1.0.0 cannot resume legacy instances.`,
      `Migrate the workflow with 'lrail wf <name> migrate', then create a fresh instance.`,
    ].join("\n"),
  );
}
