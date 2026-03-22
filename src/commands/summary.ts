import { loadWorkflow } from "../engine/workflow.js";
import { normalizeDeps } from "../engine/workflow.js";
import { resolveTemplate } from "../engine/context.js";
import type { WorkflowDef, StepDef } from "../types.js";

// ── ANSI Colors ──
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
};

export function runSummary(workflowName: string, rawParams?: string[], variant?: string): void {
  const def = loadWorkflow(workflowName, variant);

  // Parse params
  const params: Record<string, unknown> = {};
  if (rawParams) {
    for (const p of rawParams) {
      const eq = p.indexOf("=");
      if (eq === -1) continue;
      const key = p.slice(0, eq);
      const val = p.slice(eq + 1);
      const num = Number(val);
      params[key] = isNaN(num) ? val : num;
    }
  }
  // Apply defaults for missing params
  if (def.params) {
    for (const [key, paramDef] of Object.entries(def.params)) {
      if (!(key in params) && paramDef.default !== undefined) {
        params[key] = paramDef.default;
      }
    }
  }

  const hasExplicitParams = rawParams !== undefined && rawParams.length > 0;
  const hasParams = Object.keys(params).length > 0;

  // ── Header ──
  const phase = def.phase || "draft";
  const version = def.version || "0.1.0";
  const phaseColor = phase === "stable" ? c.green : phase === "dev" ? c.yellow : c.gray;
  console.log(`${c.bold}${c.cyan}${def.name}${c.reset}  ${phaseColor}${phase}${c.reset}  ${c.dim}v${version}${c.reset}${variant ? `  ${c.magenta}[variant: ${variant}]${c.reset}` : ""}`);
  if (def.description) console.log(`  ${c.dim}${def.description}${c.reset}`);
  console.log();

  // ── Params ──
  if (def.params && Object.keys(def.params).length > 0) {
    console.log(`${c.bold}Params:${c.reset}`);
    for (const [key, p] of Object.entries(def.params)) {
      const req = p.required
        ? `${c.red}required${c.reset}`
        : `${c.dim}default=${JSON.stringify(p.default ?? "")}${c.reset}`;
      const resolved = hasParams && key in params ? `  ${c.green}= ${params[key]}${c.reset}` : "";
      const desc = p.description ? `  ${c.dim}— ${p.description}${c.reset}` : "";
      console.log(`  ${c.white}${key}${c.reset}  ${c.dim}${p.type}${c.reset}  ${req}${resolved}${desc}`);
    }
    console.log();
  }

  // ── Collect param usage in validation ──
  const paramUsage = collectParamUsage(def);

  // ── Step type ratio ──
  const agenticCount = def.steps.filter((s) => (s.type || "agentic") === "agentic").length;
  const programmaticCount = def.steps.length - agenticCount;
  const ratio = Math.round((programmaticCount / def.steps.length) * 100);
  const ratioWarn = programmaticCount === 0 && def.steps.length > 1;
  console.log(
    `${c.bold}Steps:${c.reset} ${def.steps.length}  ` +
    `${c.magenta}agentic: ${agenticCount}${c.reset}  ` +
    `${c.blue}programmatic: ${programmaticCount}${c.reset}  ` +
    `${c.dim}(${ratio}% programmatic)${c.reset}` +
    (ratioWarn ? `  ${c.yellow}⚠ all agentic${c.reset}` : ""),
  );
  console.log();

  // ── Pipeline ──
  console.log(`${c.bold}Pipeline:${c.reset}`);

  const warnings: string[] = [];

  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const stepType = step.type || "agentic";
    const deps = normalizeDeps(step.depends_on);
    const depStr = deps.length > 0 ? `  ${c.dim}← ${deps.join(", ")}${c.reset}` : "";

    // Step type color
    const typeColor = stepType === "programmatic" ? c.blue : c.magenta;

    // Accumulate info
    let accStr = "";
    if (step.accumulate) {
      const parts = Object.entries(step.accumulate).map(([f, cfg]) => `${f}→${cfg.key}`);
      accStr = `  ${c.cyan}accumulate(${parts.join(", ")})${c.reset}`;
    }

    console.log(`  ${c.bold}${i + 1}. ${step.id}${c.reset}  ${typeColor}[${stepType}]${c.reset}${accStr}${depStr}`);

    // Required output
    if (step.required_output && step.required_output.length > 0) {
      console.log(`     ${c.dim}output:${c.reset} ${step.required_output.join(", ")}`);
    }

    // Context in
    if (step.context_in) {
      const ctxParts = Object.entries(step.context_in).map(([k, v]) => `${c.green}${k}${c.reset} ${c.dim}←${c.reset} ${v}`);
      console.log(`     ${c.dim}context:${c.reset} ${ctxParts.join(", ")}`);
    }

    // Validation gates (compact)
    const gates = formatGates(step, params, hasParams);
    if (gates.length > 0) {
      console.log(`     ${c.dim}gates:${c.reset} ${gates.join(`${c.dim},${c.reset} `)}`);
    }

    // Resolved prompt (only when explicit --param provided)
    if (hasExplicitParams && step.instruction) {
      const resolved = resolveTemplate(step.instruction, params, {});
      const lines = resolved.trim().split("\n");
      console.log(`     ${c.dim}┌─ prompt ─${c.reset}`);
      for (const line of lines) {
        console.log(`     ${c.dim}│${c.reset} ${line}`);
      }
      console.log(`     ${c.dim}└─${c.reset}`);
    }

    if (i < def.steps.length - 1) console.log(`     ${c.dim}↓${c.reset}`);
  }
  console.log();

  // ── Param usage warnings ──
  if (def.params && hasParams) {
    const allParamKeys = Object.keys(def.params);
    for (const k of allParamKeys) {
      if (!paramUsage.has(k)) {
        warnings.push(`param '${c.white}${k}${c.reset}' not used in any validation gate`);
      }
    }
  }

  // ── Gate imbalance detection ──
  const imbalances = detectGateImbalance(def, params, hasParams);
  warnings.push(...imbalances);

  if (warnings.length > 0) {
    console.log(`${c.bold}${c.yellow}Warnings:${c.reset}`);
    for (const msg of warnings) {
      console.log(`  ${c.yellow}⚠${c.reset}  ${msg}`);
    }
    console.log();
  }

  // ── Policy ──
  if (def.policy) {
    const modeColor = def.policy.mode === "enforce" ? c.green : c.yellow;
    console.log(`${c.bold}Policy:${c.reset} ${modeColor}${def.policy.mode}${c.reset}${def.policy.rules ? ` ${c.dim}(${def.policy.rules.length} rules)${c.reset}` : ""}`);
  }
}

function formatGates(step: StepDef, params: Record<string, unknown>, resolve: boolean): string[] {
  const gates: string[] = [];
  const rules = [...(step.validation || []), ...(step.assertions || [])];
  for (const rule of rules) {
    if (rule.op === "type") continue; // skip type checks for brevity
    let valStr = rule.value !== undefined ? String(rule.value) : "";
    if (resolve && typeof rule.value === "string") {
      valStr = resolveTemplate(String(rule.value), params, {});
    }
    if (rule.op === "each_has") {
      gates.push(`${c.dim}each_has(${c.reset}${valStr}${c.dim})${c.reset}`);
    } else if (valStr) {
      gates.push(`${rule.field}:${c.cyan}${rule.op}${c.reset}(${c.white}${valStr}${c.reset})`);
    } else {
      gates.push(`${rule.field}:${c.cyan}${rule.op}${c.reset}`);
    }
  }
  return gates;
}

function collectParamUsage(def: WorkflowDef): Set<string> {
  const used = new Set<string>();
  const paramKeys = new Set(Object.keys(def.params || {}));

  for (const step of def.steps) {
    const rules = [...(step.validation || []), ...(step.assertions || [])];
    for (const rule of rules) {
      if (typeof rule.value === "string") {
        const match = rule.value.match(/\{\{(\w+)\}\}/g);
        if (match) {
          for (const m of match) {
            const name = m.slice(2, -2);
            if (paramKeys.has(name)) used.add(name);
          }
        }
      }
    }
  }
  return used;
}

function detectGateImbalance(def: WorkflowDef, params: Record<string, unknown>, resolve: boolean): string[] {
  const warnings: string[] = [];

  // For accumulate steps, track min_length values through the pipeline
  const gateValues: { stepId: string; field: string; minLength: number }[] = [];

  for (const step of def.steps) {
    if (!step.accumulate) continue;
    const rules = [...(step.validation || [])];
    for (const rule of rules) {
      if (rule.op === "min_length" && step.accumulate[rule.field]) {
        let val = rule.value;
        if (resolve && typeof val === "string") {
          const resolved = resolveTemplate(String(val), params, {});
          val = Number(resolved);
        }
        const num = Number(val);
        if (!isNaN(num)) {
          gateValues.push({ stepId: step.id, field: rule.field, minLength: num });
        }
      }
    }
  }

  // Check for large drops between consecutive accumulate steps
  for (let i = 1; i < gateValues.length; i++) {
    const prev = gateValues[i - 1];
    const curr = gateValues[i];
    if (curr.minLength < prev.minLength * 0.5) {
      warnings.push(
        `gate drop: ${prev.stepId}(${prev.field} ${c.green}≥${prev.minLength}${c.reset}) → ${curr.stepId}(${curr.field} ${c.red}≥${curr.minLength}${c.reset})`,
      );
    }
  }

  return warnings;
}
