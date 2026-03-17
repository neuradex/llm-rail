import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkflowDef, StepDef } from "../types.js";
import { loadYaml } from "../util.js";

export function loadWorkflow(name: string): WorkflowDef {
  const filePath = path.resolve("workflows", `${name}.yml`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Workflow file not found: ${filePath}`);
  }
  return loadYaml<WorkflowDef>(filePath);
}

export function validateWorkflowDef(def: WorkflowDef): string[] {
  const errors: string[] = [];

  if (!def.name) errors.push("Workflow must have a name");
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    errors.push("Workflow must have at least one step");
    return errors;
  }

  const ids = new Set<string>();
  for (const step of def.steps) {
    if (!step.id) {
      errors.push("Each step must have an id");
      continue;
    }
    if (ids.has(step.id)) {
      errors.push(`Duplicate step id: ${step.id}`);
    }
    ids.add(step.id);

    if (!step.description) {
      errors.push(`Step '${step.id}' must have a description`);
    }
    if (!Array.isArray(step.required_output) || step.required_output.length === 0) {
      errors.push(`Step '${step.id}' must have at least one required_output`);
    }
  }

  // depends_on reference check
  for (const step of def.steps) {
    if (step.depends_on && !ids.has(step.depends_on)) {
      errors.push(`Step '${step.id}' depends_on unknown step '${step.depends_on}'`);
    }
  }

  // cycle detection
  const cycleErrors = detectCycles(def.steps);
  errors.push(...cycleErrors);

  return errors;
}

function detectCycles(steps: StepDef[]): string[] {
  const graph = new Map<string, string>();
  for (const step of steps) {
    if (step.depends_on) {
      graph.set(step.id, step.depends_on);
    }
  }

  const visited = new Set<string>();
  const errors: string[] = [];

  for (const step of steps) {
    const path = new Set<string>();
    let current: string | undefined = step.id;
    while (current && !visited.has(current)) {
      if (path.has(current)) {
        errors.push(`Cycle detected involving step '${current}'`);
        break;
      }
      path.add(current);
      current = graph.get(current);
    }
    for (const id of path) visited.add(id);
  }

  return errors;
}
