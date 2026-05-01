import { loadWorkflowAny } from "../engine/workflow-any.js";
import { isCallStep, isRouterStep, type WorkflowV1Def } from "../types-v1.js";

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

/**
 * High-level color summary of a v1 workflow. Replaces the legacy summary
 * which depended on params + accumulate + tips. Variant arg is rejected
 * (v1 variants land post-1.0).
 */
export function runSummary(workflowName: string, _rawParams?: string[], variant?: string): void {
  if (variant) {
    console.error(`v1 workflows do not yet support variants. Run without --variant.`);
    process.exit(1);
  }
  const { def } = loadWorkflowAny(workflowName);
  printV1Summary(def);
}

function printV1Summary(def: WorkflowV1Def): void {
  const phase = def.phase || "draft";
  const version = def.version || "0.1.0";
  const phaseColor = phase === "stable" ? c.green : phase === "dev" ? c.yellow : c.gray;

  console.log(
    `${c.bold}${c.cyan}${def.name}${c.reset}  ` +
      `${phaseColor}${phase}${c.reset}  ` +
      `${c.dim}v${version}${c.reset}  ` +
      `${c.dim}[v1]${c.reset}`,
  );
  if (def.description) console.log(`  ${c.dim}${def.description}${c.reset}`);
  console.log();

  // Boundary schemas
  console.log(`${c.bold}IO:${c.reset}  ${c.dim}input=${c.reset}${c.white}${def.input}${c.reset}  ${c.dim}output=${c.reset}${c.white}${def.output}${c.reset}`);
  if (def.max_depth !== undefined) {
    console.log(`     ${c.dim}max_depth=${c.reset}${def.max_depth}`);
  }
  console.log();

  // Schema list
  const schemaNames = Object.keys(def.schemas);
  console.log(`${c.bold}Schemas:${c.reset} ${schemaNames.length}`);
  if (schemaNames.length > 0) {
    console.log(`  ${c.dim}${schemaNames.join(", ")}${c.reset}`);
  }
  console.log();

  // Step type counts
  const counts = { agentic: 0, programmatic: 0, router: 0, call: 0 };
  for (const s of def.steps) counts[s.type]++;
  console.log(
    `${c.bold}Steps:${c.reset} ${def.steps.length}  ` +
      `${c.magenta}agentic=${counts.agentic}${c.reset}  ` +
      `${c.blue}programmatic=${counts.programmatic}${c.reset}  ` +
      `${c.cyan}router=${counts.router}${c.reset}  ` +
      `${c.green}call=${counts.call}${c.reset}`,
  );
  console.log();

  // Pipeline
  console.log(`${c.bold}Pipeline:${c.reset}`);
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const typeColor =
      step.type === "programmatic" ? c.blue
      : step.type === "agentic" ? c.magenta
      : step.type === "router" ? c.cyan
      : c.green;
    console.log(`  ${c.bold}${i + 1}. ${step.id}${c.reset}  ${typeColor}[${step.type}]${c.reset}`);

    if ("required_output" in step && step.required_output) {
      console.log(`     ${c.dim}output:${c.reset} ${c.white}${step.required_output}${c.reset}`);
    }
    if ("context_in" in step && step.context_in) {
      const parts = Object.entries(step.context_in).map(([k, v]) => {
        const tmpl = typeof v === "string" ? v : v.from;
        return `${c.green}${k}${c.reset}${c.dim}←${c.reset}${tmpl}`;
      });
      console.log(`     ${c.dim}context:${c.reset} ${parts.join(", ")}`);
    }
    if (isRouterStep(step)) {
      console.log(`     ${c.dim}cases:${c.reset} ${step.cases.length}  ${c.dim}default:${c.reset} ${c.white}${step.default}${c.reset}${step.max_iterations !== undefined ? `  ${c.dim}max_iter=${step.max_iterations}${c.reset}` : ""}`);
    }
    if (isCallStep(step)) {
      console.log(`     ${c.dim}calls:${c.reset} ${c.white}${step.workflow}${c.reset}  ${c.dim}inputs:${c.reset} ${Object.keys(step.inputs).join(", ") || "(none)"}`);
    }
    if (i < def.steps.length - 1) console.log(`     ${c.dim}↓${c.reset}`);
  }
  console.log();

  if (def.policy) {
    const modeColor = def.policy.mode === "enforce" ? c.green : c.yellow;
    console.log(
      `${c.bold}Policy:${c.reset} ${modeColor}${def.policy.mode}${c.reset}` +
        (def.policy.rules ? ` ${c.dim}(${def.policy.rules.length} rules)${c.reset}` : ""),
    );
  }
}
