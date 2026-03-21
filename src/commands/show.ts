import { loadWorkflow } from "../engine/workflow.js";
import { resolveWorkflowPath, loadVariant, mergeVariantAnnotated } from "../engine/variant.js";
import { loadYaml } from "../util.js";
import * as yaml from "js-yaml";
import type { WorkflowDef } from "../types.js";

export function runShow(workflowName: string, variant?: string): void {
  if (variant) {
    const { basePath } = resolveWorkflowPath(workflowName);
    const base = loadYaml<WorkflowDef>(basePath);
    const variantDef = loadVariant(workflowName, variant);
    const annotated = mergeVariantAnnotated(base, variantDef);
    console.log(annotated);
  } else {
    const def = loadWorkflow(workflowName);
    const output = yaml.dump(def, { lineWidth: 120, noRefs: true });
    console.log(output);
    console.log(`Steps: ${def.steps.length}`);
    console.log(`Phase: ${def.phase || "draft"}`);
  }
}
