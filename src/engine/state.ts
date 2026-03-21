import * as fs from "node:fs";
import * as path from "node:path";
import type { InstanceState, WorkflowDef } from "../types.js";
import { generateId, nowISO, saveYaml, loadYaml, ensureDir } from "../util.js";
import { instanceDir } from "../audit/logger.js";
import { generateAlias, collectExistingAliases, resolveAlias } from "./alias.js";

const STATE_DIR = ".llm-rail";

export function createInstance(
  def: WorkflowDef,
  params?: Record<string, unknown>,
  variant?: string,
): InstanceState {
  const id = generateId();
  const now = nowISO();
  const existingAliases = collectExistingAliases(path.resolve(STATE_DIR));
  const alias = generateAlias(existingAliases);

  const steps: InstanceState["steps"] = {};
  for (const step of def.steps) {
    steps[step.id] = { status: "pending" };
  }

  const state: InstanceState = {
    id,
    alias,
    workflow_name: def.name,
    ...(variant && { variant }),
    status: "created",
    created_at: now,
    updated_at: now,
    current_step: 0,
    steps,
    context: def.context ? { ...def.context } : {},
    ...(params && Object.keys(params).length > 0 && { params }),
  };

  const dir = instanceDir(def.name, id);
  ensureDir(dir);
  saveYaml(path.resolve(dir, "state.yaml"), state);
  fs.writeFileSync(path.resolve(dir, "alias"), alias, "utf-8");
  return state;
}

export function resolveInstanceId(idOrAlias: string): string {
  const baseDir = path.resolve(STATE_DIR);

  // Try direct ID first
  if (fs.existsSync(baseDir)) {
    for (const workflowDir of fs.readdirSync(baseDir)) {
      const dirPath = path.resolve(baseDir, workflowDir);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      if (fs.existsSync(path.resolve(dirPath, idOrAlias, "state.yaml"))) {
        return idOrAlias;
      }
    }
  }

  // Try alias resolution
  const resolved = resolveAlias(baseDir, idOrAlias);
  if (resolved) return resolved;

  throw new Error(`Instance not found: ${idOrAlias}`);
}

export function loadInstance(idOrAlias: string): InstanceState {
  const id = resolveInstanceId(idOrAlias);
  const baseDir = path.resolve(STATE_DIR);

  for (const workflowDir of fs.readdirSync(baseDir)) {
    const dirPath = path.resolve(baseDir, workflowDir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const stateFile = path.resolve(dirPath, id, "state.yaml");
    if (fs.existsSync(stateFile)) {
      return loadYaml<InstanceState>(stateFile);
    }
  }

  throw new Error(`Instance not found: ${idOrAlias}`);
}

export function saveInstance(state: InstanceState): void {
  state.updated_at = nowISO();
  const dir = instanceDir(state.workflow_name, state.id);
  ensureDir(dir);
  saveYaml(path.resolve(dir, "state.yaml"), state);
}

export function listInstances(): InstanceState[] {
  const baseDir = path.resolve(STATE_DIR);
  if (!fs.existsSync(baseDir)) return [];

  const instances: InstanceState[] = [];

  for (const workflowDir of fs.readdirSync(baseDir)) {
    const wfPath = path.resolve(baseDir, workflowDir);
    if (!fs.statSync(wfPath).isDirectory()) continue;

    for (const instanceDir of fs.readdirSync(wfPath)) {
      const stateFile = path.resolve(wfPath, instanceDir, "state.yaml");
      if (!fs.existsSync(stateFile)) continue;
      try {
        const state = loadYaml<InstanceState>(stateFile);
        if (state.id && state.workflow_name) {
          instances.push(state);
        }
      } catch {
        // skip invalid files
      }
    }
  }

  return instances;
}
