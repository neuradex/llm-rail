import * as fs from "node:fs";
import * as path from "node:path";
import { getDataDir, resolvePackageDir } from "../util.js";

/**
 * Initialize LLM Rail in the current project.
 * Creates lrail.yml, workflows/, .llm-rail/, and updates .gitignore.
 */
export function runInit(): void {
  const cwd = process.cwd();
  const results: string[] = [];

  // 1. Copy lrail.yml template from builtins
  const configPath = path.resolve(cwd, "lrail.yml");
  if (fs.existsSync(configPath)) {
    results.push("lrail.yml already exists — skipped");
  } else {
    const builtinsDir = resolvePackageDir("builtins");
    const templatePath = path.resolve(builtinsDir, "lrail.default.yml");
    fs.copyFileSync(templatePath, configPath);
    results.push("Created lrail.yml");
  }

  // 2. Create workflows/ directory
  const workflowsDir = path.resolve(cwd, "workflows");
  if (fs.existsSync(workflowsDir)) {
    results.push("workflows/ already exists — skipped");
  } else {
    fs.mkdirSync(workflowsDir, { recursive: true });
    results.push("Created workflows/");
  }

  // 3. Create data directory (runtime state)
  const runtimeDir = path.resolve(getDataDir());
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true });
  }

  // 4. Add .llm-rail/ to .gitignore
  const gitignorePath = path.resolve(cwd, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    if (content.includes(".llm-rail/")) {
      results.push(".gitignore already has .llm-rail/ — skipped");
    } else {
      fs.appendFileSync(gitignorePath, "\n.llm-rail/\n");
      results.push("Added .llm-rail/ to .gitignore");
    }
  } else {
    fs.writeFileSync(gitignorePath, ".llm-rail/\n");
    results.push("Created .gitignore with .llm-rail/");
  }

  // Report
  console.log("Initialized LLM Rail:\n");
  for (const r of results) {
    console.log(`  ${r}`);
  }
  console.log("\nNext steps:");
  console.log("  lrail docs                  Browse documentation");
  console.log("  /llm-rail:design            Design a workflow from a task description");
  console.log("  Edit lrail.yml              Configure policy");
}
