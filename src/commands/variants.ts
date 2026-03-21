import { listVariants, loadVariant } from "../engine/variant.js";

export function runVariants(workflowName: string): void {
  const variants = listVariants(workflowName);

  if (variants.length === 0) {
    console.log(`No variants found for workflow '${workflowName}'.`);
    console.log("Variants must be in workflows/<name>/<variant>.workflow.yml");
    return;
  }

  console.log(`Variants for '${workflowName}':`);
  for (const v of variants) {
    try {
      const def = loadVariant(workflowName, v);
      const stepCount = def.steps?.length || 0;
      const desc = def.description ? ` — ${def.description}` : "";
      const stepInfo = stepCount > 0 ? ` (${stepCount} step overrides)` : "";
      console.log(`  ${v}${desc}${stepInfo}`);
    } catch {
      console.log(`  ${v}  (error loading)`);
    }
  }
}
