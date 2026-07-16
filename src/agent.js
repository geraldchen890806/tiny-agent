import Anthropic from "@anthropic-ai/sdk";
import { Context } from "./context.js";
import { tools, runTool, validateInput, toolByName } from "./tools.js";
import { gate } from "./gate.js";
import { PROMPT_V1, PROMPT_V2 } from "./prompts.js";
import { verify } from "./verifier.js";

const client = new Anthropic();
const MODEL = "claude-opus-4-7";
const MAX_STEPS = 20;
const MAX_VERIFY_ROUNDS = 2;

// Retry only what a retry can fix: 429/529/5xx are timing problems; a 400 is a content
// problem and resending it just donates to the invoice (blog 06).
export async function withRetry(fn, { retries = 3, baseMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err.status === 429 || err.status === 529 || err.status >= 500;
      if (!retryable || attempt >= retries) throw err;
      const wait = baseMs * 2 ** attempt;
      console.error(`[retry · status=${err.status} attempt=${attempt + 1} wait=${wait}ms]`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

const promptArg = process.argv.find(a => a.startsWith("--prompt="));
const version = promptArg?.split("=")[1] ?? "v2";
const task = process.argv.slice(2).find(a => !a.startsWith("--"));
const ctx = new Context(version === "v1" ? PROMPT_V1 : PROMPT_V2, client, MODEL);

async function main(task) {
  ctx.addUser(task);
  let steps = 0;
  let verifyRounds = 0;

  while (steps < MAX_STEPS) {
    steps++;
    const compressed = await ctx.maybeCompress();
    if (compressed) console.error(`[compressed history · ${ctx.messages.length} messages left]`);

    const res = await withRetry(() => client.messages.create(ctx.toRequest(tools)));
    ctx.recordUsage(res.usage);
    ctx.addAssistant(res.content);
    console.error(`[turn · in=${res.usage.input_tokens} out=${res.usage.output_tokens} cache_read=${res.usage.cache_read_input_tokens ?? 0}]`);

    if (res.stop_reason === "end_turn") {
      const output = res.content.find(b => b.type === "text")?.text ?? "";
      if (verifyRounds >= MAX_VERIFY_ROUNDS) {
        console.error(`[verify · rounds exhausted, unverified output — hand to human]`);
        return output;
      }
      const verdict = await verify(client, MODEL, task, output);
      console.error(`[verify · ${verdict.pass ? "PASS" : "FAIL: " + verdict.reason}]`);
      if (verdict.pass) return output;
      verifyRounds++;
      ctx.addUser(`[verifier] FAIL: ${verdict.reason}\nThe task is NOT done. Fix it and finish properly.`);
      continue;
    }
    if (res.stop_reason === "tool_use") {
      const toolResults = [];
      for (const b of res.content.filter(b => b.type === "tool_use")) {
        // Data layer first: an ill-formed call has no business entering the "should this
        // happen" debate, and consequence() must never read unvalidated input (blog 07).
        const spec = toolByName[b.name];
        const errors = spec ? validateInput(spec.input_schema, b.input) : [];
        const verdict = errors.length
          ? { ok: false, reason: `input validation failed: ${errors.join("; ")}` }
          : await gate(b.name, b.input);
        const result = verdict.ok ? await runTool(b.name, b.input) : { error: verdict.reason };
        toolResults.push({
          type: "tool_result",
          tool_use_id: b.id,
          content: result.error ?? result.content,
          is_error: !!result.error,
        });
      }
      ctx.addToolResults(toolResults);
    }
  }
  console.error(`[abort · hit MAX_STEPS=${MAX_STEPS}]`);
}

// subagent.js imports withRetry from this module, so importing it must be
// side-effect-free: only run the loop when this file is the entry point.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(task ?? "hi, who are you?").then(out => {
    if (out != null) console.log(out);
  });
}
