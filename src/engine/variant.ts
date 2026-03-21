import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { WorkflowDef, VariantDef, StepDef } from "../types.js";
import { loadYaml } from "../util.js";

/**
 * Resolve the builtins directory — package root or cwd fallback.
 */
function resolveBuiltinsDir(): string {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    const dir = path.resolve(pluginRoot, "builtins");
    if (fs.existsSync(dir)) return dir;
  }
  const local = path.resolve("builtins");
  if (fs.existsSync(local)) return local;
  return "";
}

/**
 * Resolve workflow path — directory format or single file.
 * Resolution order: workflows/ (user) → builtins/ (package).
 * Directory format takes priority when both exist.
 */
export function resolveWorkflowPath(name: string): { basePath: string; isDirectory: boolean } {
  // 1. User workflows
  const dirPath = path.resolve("workflows", name);
  const dirBase = path.resolve(dirPath, "workflow.yml");
  if (fs.existsSync(dirBase)) {
    return { basePath: dirBase, isDirectory: true };
  }

  const filePath = path.resolve("workflows", `${name}.yml`);
  if (fs.existsSync(filePath)) {
    return { basePath: filePath, isDirectory: false };
  }

  // 2. Builtin workflows
  const builtinsDir = resolveBuiltinsDir();
  if (builtinsDir) {
    const builtinDir = path.resolve(builtinsDir, name);
    const builtinDirBase = path.resolve(builtinDir, "workflow.yml");
    if (fs.existsSync(builtinDirBase)) {
      return { basePath: builtinDirBase, isDirectory: true };
    }

    const builtinFile = path.resolve(builtinsDir, `${name}.yml`);
    if (fs.existsSync(builtinFile)) {
      return { basePath: builtinFile, isDirectory: false };
    }
  }

  throw new Error(`Workflow not found: ${name}`);
}

/**
 * List variant names for a workflow (scans *.workflow.yml, excludes workflow.yml).
 */
export function listVariants(name: string): string[] {
  const dirPath = path.resolve("workflows", name);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith(".workflow.yml") && f !== "workflow.yml")
    .map((f) => f.replace(/\.workflow\.yml$/, ""))
    .sort();
}

/**
 * Load a variant definition file.
 */
export function loadVariant(workflowName: string, variantName: string): VariantDef {
  const variantPath = path.resolve("workflows", workflowName, `${variantName}.workflow.yml`);
  if (!fs.existsSync(variantPath)) {
    throw new Error(`Variant '${variantName}' not found for workflow '${workflowName}'`);
  }

  const def = loadYaml<VariantDef>(variantPath);
  if (def.extends !== "base") {
    throw new Error(`Variant '${variantName}' must have 'extends: base'`);
  }
  if (!def.variant) {
    def.variant = variantName;
  }

  return def;
}

/**
 * Merge a variant into a base workflow definition.
 *
 * Algorithm:
 * 1. Shallow copy base
 * 2. Scalar fields (description, phase, version): variant overrides
 * 3. policy: variant replaces entirely
 * 4. context: shallow merge { ...base, ...variant }
 * 5. params: key-level merge, same key = variant wins, new key = added
 * 6. steps: match by id
 *    - Same id → field-level override (array fields like validation/tips/actions are replaced, not concatenated)
 *    - New id → appended
 *    - Missing from variant → kept from base
 *    - Base step order is preserved
 */
export function mergeVariant(base: WorkflowDef, variant: VariantDef): WorkflowDef {
  const merged: WorkflowDef = { ...base };

  // Scalar overrides
  if (variant.description !== undefined) merged.description = variant.description;
  if (variant.phase !== undefined) merged.phase = variant.phase;

  // Policy: full replace
  if (variant.policy !== undefined) merged.policy = variant.policy;

  // Context: shallow merge
  if (variant.context) {
    merged.context = { ...(base.context || {}), ...variant.context };
  }

  // Params: key-level merge
  if (variant.params) {
    merged.params = { ...(base.params || {}), ...variant.params };
  }

  // Steps: id-based merge
  if (variant.steps && variant.steps.length > 0) {
    const variantStepMap = new Map<string, Partial<StepDef>>();
    const newSteps: Partial<StepDef>[] = [];
    const baseIds = new Set(base.steps.map((s) => s.id));

    for (const vs of variant.steps) {
      if (!vs.id) continue;
      if (baseIds.has(vs.id)) {
        variantStepMap.set(vs.id, vs);
      } else {
        newSteps.push(vs);
      }
    }

    // Merge existing steps (preserve base order)
    merged.steps = base.steps.map((baseStep) => {
      const override = variantStepMap.get(baseStep.id);
      if (!override) return { ...baseStep };
      return mergeStep(baseStep, override);
    });

    // Append new steps
    for (const ns of newSteps) {
      merged.steps.push(ns as StepDef);
    }
  } else {
    merged.steps = base.steps.map((s) => ({ ...s }));
  }

  return merged;
}

function mergeStep(base: StepDef, override: Partial<StepDef>): StepDef {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (key === "id") continue;
    if (value !== undefined) {
      (merged as any)[key] = value;
    }
  }

  return merged;
}

/**
 * Merge variant and return YAML string with origin annotations as comments.
 */
export function mergeVariantAnnotated(base: WorkflowDef, variant: VariantDef): string {
  const merged = mergeVariant(base, variant);
  const yamlStr = yaml.dump(merged, { lineWidth: 120, noRefs: true });

  // Add header comment
  const header = `# Merged: base + variant '${variant.variant}'\n# This is a computed view — not a real file.\n\n`;
  return header + yamlStr;
}
