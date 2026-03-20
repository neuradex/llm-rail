import { loadWorkflow, validateWorkflowDef } from "../engine/workflow.js";

export function runValidate(workflowName: string): void {
  const def = loadWorkflow(workflowName);
  const errors = validateWorkflowDef(def);

  if (errors.length > 0) {
    console.error("Validation errors:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`Workflow '${def.name}' is valid.`);
  console.log(`  Steps: ${def.steps.length}`);
  if (def.params) {
    console.log(`  Params: ${Object.keys(def.params).join(", ")}`);
  }
}
