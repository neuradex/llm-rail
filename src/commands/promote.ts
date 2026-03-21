import * as fs from "node:fs";
import * as path from "node:path";
import { loadWorkflow } from "../engine/workflow.js";
import { listInstances } from "../engine/state.js";
import { instanceDir } from "../audit/logger.js";
import type { WorkflowPhase } from "../types.js";

interface PolicyLogEntry {
  timestamp: string;
  step_id: string;
  command: string;
  allowed: boolean;
}

/**
 * Analyze completed runs and suggest phase promotion.
 */
export function runPromote(workflowName: string): void {
  const def = loadWorkflow(workflowName);
  const currentPhase: WorkflowPhase = def.phase || "draft";

  console.log(`Workflow: ${workflowName}`);
  console.log(`Current phase: ${currentPhase}`);
  console.log("");

  // Gather completed instances
  const instances = listInstances()
    .filter((i) => i.workflow_name === workflowName && i.status === "completed");

  if (instances.length === 0) {
    console.log("No completed instances found. Run the workflow first.");
    return;
  }

  console.log(`Completed runs: ${instances.length}`);
  console.log("");

  // Analyze each agentic step
  const agenticSteps = def.steps.filter((s) => (s.type || "agentic") === "agentic");
  const programmaticSteps = def.steps.filter((s) => s.type === "programmatic");

  if (agenticSteps.length === 0) {
    if (currentPhase === "dev") {
      console.log("All steps are programmatic. Ready to promote to 'stable'.");
      if (!def.policy || def.policy.mode !== "enforce") {
        console.log("  → Add policy mode 'enforce' before locking.");
      }
    } else if (currentPhase === "stable") {
      console.log("Already stable. No changes needed.");
    } else {
      console.log("All steps are programmatic. Consider promoting to 'stable'.");
    }
    return;
  }

  console.log(`Agentic steps: ${agenticSteps.map((s) => s.id).join(", ")}`);
  console.log(`Programmatic steps: ${programmaticSteps.length > 0 ? programmaticSteps.map((s) => s.id).join(", ") : "(none)"}`);
  console.log("");

  // For each agentic step, analyze bash proxy logs from all completed instances
  const stepCommands = new Map<string, Set<string>>();
  const stepCompletionCount = new Map<string, number>();

  for (const inst of instances) {
    // Count step completions
    for (const [stepId, stepState] of Object.entries(inst.steps)) {
      if (stepState.status === "completed") {
        stepCompletionCount.set(stepId, (stepCompletionCount.get(stepId) || 0) + 1);
      }
    }

    // Read policy log for bash commands
    const dir = instanceDir(workflowName, inst.id);
    const policyLogPath = path.resolve(dir, "policy.jsonl");
    if (!fs.existsSync(policyLogPath)) continue;

    const lines = fs.readFileSync(policyLogPath, "utf-8").trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as PolicyLogEntry;
        if (!stepCommands.has(entry.step_id)) {
          stepCommands.set(entry.step_id, new Set());
        }
        stepCommands.get(entry.step_id)!.add(entry.command);
      } catch {
        // skip
      }
    }
  }

  // Suggest promotions
  console.log("─── Step Analysis ───");
  console.log("");

  for (const step of agenticSteps) {
    const completions = stepCompletionCount.get(step.id) || 0;
    const commands = stepCommands.get(step.id);

    console.log(`  ${step.id} (agentic, ${completions} completions)`);

    if (commands && commands.size > 0) {
      console.log(`    Observed bash commands:`);
      for (const cmd of commands) {
        console.log(`      $ ${cmd}`);
      }
      console.log(`    → Candidate for programmatic conversion`);
    } else if (completions >= 2) {
      console.log(`    No bash commands observed. Step relies on agent judgment.`);
      console.log(`    → Review if output pattern is stable enough for programmatic`);
    } else {
      console.log(`    → Need more runs to assess (${completions} so far)`);
    }
    console.log("");
  }

  // Phase suggestion
  console.log("─── Recommendation ───");
  console.log("");

  if (currentPhase === "draft") {
    if (instances.length >= 2) {
      console.log(`Promote to 'dev' — ${instances.length} successful runs recorded.`);
      console.log("  → Set phase: dev in your workflow YAML");
      if (agenticSteps.length > 0) {
        console.log(`  → Consider converting stable agentic steps to programmatic`);
      }
    } else {
      console.log("Stay at 'draft' — need more successful runs before promoting.");
    }
  } else if (currentPhase === "dev") {
    if (agenticSteps.length === 0) {
      console.log("Ready to promote to 'stable' — all steps are programmatic.");
    } else {
      console.log(`${agenticSteps.length} agentic step(s) remain. Convert to programmatic before locking.`);
    }
  } else {
    console.log("Already stable.");
  }
}
