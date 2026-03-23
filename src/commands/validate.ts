import { loadWorkflow, loadWorkflowFromPath, validateWorkflowDef } from "../engine/workflow.js";

export function runValidate(workflowName: string, variant?: string, filePath?: string): void {
  const def = filePath ? loadWorkflowFromPath(filePath) : loadWorkflow(workflowName, variant);
  const errors = validateWorkflowDef(def);

  if (errors.length > 0) {
    console.error("Validation errors:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("\nRun 'lrail docs' for documentation on workflow concepts.");
    process.exit(1);
  }

  const label = variant ? `'${def.name}' (variant: ${variant})` : `'${def.name}'`;
  console.log(`Workflow ${label} is valid.`);
  console.log(`  Phase: ${def.phase || "draft"}`);
  console.log(`  Steps: ${def.steps.length}`);
  const agentic = def.steps.filter((s) => (s.type || "agentic") === "agentic").length;
  const programmatic = def.steps.filter((s) => s.type === "programmatic").length;
  if (programmatic > 0) {
    console.log(`  Types: ${agentic} agentic, ${programmatic} programmatic`);
  }
  if (def.params) {
    console.log(`  Params: ${Object.keys(def.params).join(", ")}`);
  }
}
