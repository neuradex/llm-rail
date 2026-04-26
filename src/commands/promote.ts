import * as fs from "node:fs";
import * as path from "node:path";
import { instanceDir } from "../audit/logger.js";
import type { WorkflowPhase } from "../types.js";
import { loadWorkflowAny } from "../engine/workflow-any.js";
import { isAgenticStep, isProgrammaticStep, isRouterStep, isCallStep } from "../types-v1.js";
import { listV1Instances } from "../engine/state-v1.js";

interface PolicyLogEntry {
  timestamp: string;
  step_id: string;
  command: string;
  allowed: boolean;
}

/**
 * v1 promote analysis: looks at completed runs and suggests phase
 * advancement based on step-type composition (agentic vs programmatic),
 * observed bash commands, and policy mode.
 */
export function runPromote(workflowName: string): void {
  const { def } = loadWorkflowAny(workflowName);
  const currentPhase: WorkflowPhase = def.phase || "draft";

  console.log(`Workflow: ${workflowName}`);
  console.log(`Current phase: ${currentPhase}`);
  console.log("");

  const instances = listV1Instances()
    .filter((i) => i.workflow_name === workflowName && i.status === "completed");

  if (instances.length === 0) {
    console.log("No completed instances found. Run the workflow first.");
    return;
  }

  console.log(`Completed runs: ${instances.length}`);
  console.log("");

  const counts = { agentic: 0, programmatic: 0, router: 0, call: 0 };
  for (const s of def.steps) counts[s.type]++;

  console.log(`Step types: ${counts.agentic} agentic, ${counts.programmatic} programmatic, ${counts.router} router, ${counts.call} call`);
  console.log("");

  const agenticSteps = def.steps.filter(isAgenticStep);
  const stepCommands = new Map<string, Set<string>>();
  const stepCompletionCount = new Map<string, number>();

  for (const inst of instances) {
    for (const [stepId, stepState] of Object.entries(inst.steps)) {
      if (stepState.status === "completed") {
        stepCompletionCount.set(stepId, (stepCompletionCount.get(stepId) || 0) + 1);
      }
    }

    const dir = instanceDir(workflowName, inst.id);
    const policyLogPath = path.resolve(dir, "proxy.jsonl");
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

  if (agenticSteps.length > 0) {
    console.log("─── Agentic step analysis ───");
    console.log("");
    for (const step of agenticSteps) {
      const completions = stepCompletionCount.get(step.id) || 0;
      const commands = stepCommands.get(step.id);

      console.log(`  ${step.id} (${completions} completions)`);
      if (commands && commands.size > 0) {
        console.log(`    Observed bash commands:`);
        for (const cmd of commands) {
          console.log(`      $ ${cmd}`);
        }
        console.log(`    → Candidate for programmatic conversion`);
      } else if (completions >= 2) {
        console.log(`    No bash commands observed. Step relies on agent judgment.`);
      } else {
        console.log(`    → Need more runs to assess (${completions} so far)`);
      }
      console.log("");
    }
  }

  console.log("─── Recommendation ───");
  console.log("");

  if (currentPhase === "draft") {
    if (instances.length >= 2) {
      console.log(`Promote to 'dev' — ${instances.length} successful runs recorded.`);
      console.log("  → Set phase: dev in your workflow YAML");
      if (agenticSteps.length > 0) {
        console.log("  → Consider converting stable agentic steps to programmatic");
      }
    } else {
      console.log("Stay at 'draft' — need more successful runs before promoting.");
    }
  } else if (currentPhase === "dev") {
    if (agenticSteps.length === 0) {
      console.log("Ready to promote to 'stable' — all decision-making steps are deterministic.");
      if (!def.policy || def.policy.mode !== "enforce") {
        console.log("  → Add policy mode 'enforce' before locking.");
      }
    } else {
      console.log(`${agenticSteps.length} agentic step(s) remain. Convert to programmatic before locking.`);
    }
  } else {
    console.log("Already stable.");
  }

  // Silence unused-helper warnings while keeping imports for future use.
  void isProgrammaticStep;
  void isRouterStep;
  void isCallStep;
}
