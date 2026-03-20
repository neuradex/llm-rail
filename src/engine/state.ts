import * as fs from "node:fs";
import * as path from "node:path";
import type { InstanceState, WorkflowDef } from "../types.js";
import { generateId, nowISO, saveYaml, loadYaml, ensureDir } from "../util.js";

const STATE_DIR = ".llm-rail";

function statePath(id: string): string {
  return path.resolve(STATE_DIR, `${id}.yaml`);
}

export function createInstance(
  def: WorkflowDef,
  params?: Record<string, unknown>,
): InstanceState {
  const id = generateId();
  const now = nowISO();

  const steps: InstanceState["steps"] = {};
  for (const step of def.steps) {
    steps[step.id] = { status: "pending" };
  }

  const state: InstanceState = {
    id,
    workflow_name: def.name,
    status: "created",
    created_at: now,
    updated_at: now,
    current_step: 0,
    steps,
    context: def.context ? { ...def.context } : {},
    ...(params && Object.keys(params).length > 0 && { params }),
  };

  ensureDir(STATE_DIR);
  saveYaml(statePath(id), state);
  return state;
}

export function loadInstance(id: string): InstanceState {
  const p = statePath(id);
  if (!fs.existsSync(p)) {
    throw new Error(`Instance not found: ${id}`);
  }
  return loadYaml<InstanceState>(p);
}

export function saveInstance(state: InstanceState): void {
  state.updated_at = nowISO();
  ensureDir(STATE_DIR);
  saveYaml(statePath(state.id), state);
}

export function listInstances(): InstanceState[] {
  ensureDir(STATE_DIR);
  const files = fs.readdirSync(path.resolve(STATE_DIR));
  const instances: InstanceState[] = [];
  for (const file of files) {
    if (!file.endsWith(".yaml")) continue;
    if (file === "hooks") continue;
    try {
      const state = loadYaml<InstanceState>(path.resolve(STATE_DIR, file));
      if (state.id && state.workflow_name) {
        instances.push(state);
      }
    } catch {
      // skip invalid files
    }
  }
  return instances;
}
