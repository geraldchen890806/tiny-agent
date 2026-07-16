// Unattended run: the confirmation gate must auto-approve, or the first write_file
// parks the whole eval on a readline prompt. Set before any import — gate.js reads env.
process.env.TINY_AGENT_AUTO_APPROVE = "1";

import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "./agent.js";

const client = new Anthropic();
const MODEL = "claude-opus-4-7";
const THRESHOLD = 0.8;

async function runCheck(check, output) {
  if (check.type === "file_exists") return existsSync(check.path);
  if (check.type === "contains") {
    return existsSync(check.path) && readFileSync(check.path, "utf-8").includes(check.text);
  }
  if (check.type === "llm_judge") {
    // The judge gets the rubric and the final output — never the transcript. A judge
    // that watches the worker struggle starts grading effort instead of results (blog 06).
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: "You are a strict grader. For each rubric item answer PASS or FAIL with a one-line reason. Last line: VERDICT: PASS (only if every item passed) or VERDICT: FAIL.",
      messages: [{
        role: "user",
        content: `<rubric>\n${check.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n</rubric>\n\n<output>\n${output}\n</output>`,
      }],
    });
    return /VERDICT:\s*PASS/.test(res.content.find(b => b.type === "text")?.text ?? "");
  }
  return false;
}

async function runCase(c, runs) {
  let passed = 0;
  for (let i = 0; i < runs; i++) {
    rmSync("workspace", { recursive: true, force: true });
    mkdirSync("workspace");
    // Cases assume a README exists in the workspace; seed a fixed one so runs reproduce.
    writeFileSync("workspace/README.md", "# tiny-agent\n\nA minimal AI agent.\n", "utf-8");
    const output = await runAgent(c.task, { cwd: "workspace" });
    let ok = true;
    for (const check of c.checks) ok = ok && await runCheck(check, output);
    if (ok) passed++;
  }
  return passed / runs;
}

const runs = Number(process.argv.find(a => a.startsWith("--runs="))?.split("=")[1] ?? 5);
const cases = JSON.parse(readFileSync("evals/cases.json", "utf-8"));
let below = 0;
for (const c of cases) {
  const rate = await runCase(c, runs);
  console.log(`${c.id.padEnd(24)} runs=${runs}  rate=${(rate * 100).toFixed(0)}%`);
  if (rate < THRESHOLD) below++;
}
process.exit(below ? 1 : 0);
