import * as yaml from "js-yaml";
import { loadWorkflowAny } from "../engine/workflow-any.js";

export function runShow(workflowName: string, variant?: string): void {
  if (variant) {
    console.error(`v1 workflows do not yet support variants. Run without --variant.`);
    process.exit(1);
  }
  const { def } = loadWorkflowAny(workflowName);
  const output = yaml.dump(def, { lineWidth: 120, noRefs: true });
  console.log(output);
  console.log(`Steps: ${def.steps.length}`);
  console.log(`Phase: ${def.phase || "draft"}`);
}
