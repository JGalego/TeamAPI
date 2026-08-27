import { access, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "packages/cli/dist/main.js");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const outputDir = path.resolve(root, option("--out", "site-out/assessments"));
const examplesDir = path.resolve(root, option("--examples", "examples"));

async function assess(input, output) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "assess", input, "--format", "json", "--out", output, "--no-config"], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      // Exit 1 is expected when an otherwise valid assessment contains blocking findings.
      if (code === 0 || code === 1) resolve();
      else reject(new Error(`teamapi assess exited with code ${code} for ${path.basename(input)}`));
    });
  });

  const report = JSON.parse(await readFile(output, "utf-8"));
  if (!report.summary || !report.snapshot || !Array.isArray(report.findings)) {
    throw new Error(`Invalid assessment artifact generated for ${path.basename(input)}`);
  }
}

try {
  await access(cli);
} catch {
  throw new Error(`Missing ${path.relative(root, cli)}. Run \`pnpm build\` before generating assessments.`);
}

const organizations = (await readdir(examplesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.endsWith("-org"))
  .map((entry) => entry.name)
  .sort();

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
for (const organization of organizations) {
  await assess(path.join(examplesDir, organization), path.join(outputDir, `${organization}.json`));
}

console.log(`Generated ${organizations.length} assessment artifact(s) in ${path.relative(root, outputDir)}/`);
