import * as fs from "node:fs";
import * as path from "node:path";

interface DocNode {
  name: string;
  description: string;
  body: string;
  children: { name: string; description: string }[];
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) meta[kv[1]] = kv[2];
  }
  return { meta, body: match[2].trim() };
}

function resolveDocsDir(): string {
  // Check plugin root first, then current directory
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    const dir = path.resolve(pluginRoot, "learn");
    if (fs.existsSync(dir)) return dir;
  }
  const local = path.resolve("learn");
  if (fs.existsSync(local)) return local;
  throw new Error("learn/ directory not found");
}

function loadNode(dirPath: string, targetPath: string): DocNode | null {
  const segments = targetPath ? targetPath.split("/").filter(Boolean) : [];
  let current = dirPath;

  for (const seg of segments) {
    const next = path.resolve(current, seg);
    if (fs.existsSync(next) && fs.statSync(next).isDirectory()) {
      current = next;
    } else if (fs.existsSync(next + ".md")) {
      // Leaf file
      const content = fs.readFileSync(next + ".md", "utf-8");
      const { meta, body } = parseFrontmatter(content);
      return { name: meta.name || seg, description: meta.description || "", body, children: [] };
    } else {
      return null;
    }
  }

  // Directory — read README.md and list children
  const readmePath = path.resolve(current, "README.md");
  let name = "";
  let description = "";
  let body = "";

  if (fs.existsSync(readmePath)) {
    const content = fs.readFileSync(readmePath, "utf-8");
    const parsed = parseFrontmatter(content);
    name = parsed.meta.name || path.basename(current);
    description = parsed.meta.description || "";
    body = parsed.body;
  }

  // Collect children
  const children: { name: string; description: string }[] = [];
  const entries = fs.readdirSync(current).sort();

  for (const entry of entries) {
    if (entry === "README.md") continue;
    const fullPath = path.resolve(current, entry);

    if (fs.statSync(fullPath).isDirectory()) {
      // Directory child — read its README for description
      const childReadme = path.resolve(fullPath, "README.md");
      if (fs.existsSync(childReadme)) {
        const { meta } = parseFrontmatter(fs.readFileSync(childReadme, "utf-8"));
        children.push({ name: entry, description: meta.description || "" });
      } else {
        children.push({ name: entry, description: "" });
      }
    } else if (entry.endsWith(".md")) {
      const childName = entry.replace(/\.md$/, "");
      const { meta } = parseFrontmatter(fs.readFileSync(fullPath, "utf-8"));
      children.push({ name: childName, description: meta.description || "" });
    }
  }

  return { name: name || path.basename(current), description, body, children };
}

export function runDocs(targetPath: string): void {
  let docsDir: string;
  try {
    docsDir = resolveDocsDir();
  } catch {
    console.error("learn/ directory not found. Make sure you're in an lrail project.");
    process.exit(1);
  }

  const node = loadNode(docsDir, targetPath);

  if (!node) {
    console.error(`Topic not found: ${targetPath}`);
    console.error("Run 'lrail docs' to see available topics.");
    process.exit(1);
  }

  // Display
  if (node.body) {
    console.log(node.body);
  }

  if (node.children.length > 0) {
    if (node.body) console.log("");
    console.log("Topics:");
    for (const child of node.children) {
      const desc = child.description ? `  — ${child.description}` : "";
      console.log(`  ${child.name}${desc}`);
    }
    console.log("");
    console.log(`Use: lrail docs <topic>`);
  }
}
