import Anthropic from "@anthropic-ai/sdk";
import { Context } from "./context.js";
import { tools, runTool, validateInput, toolByName } from "./tools.js";
import { setBaseDir } from "./tools.js";
import { gate } from "./gate.js";
import { PROMPT_V1, PROMPT_V2 } from "./prompts.js";
import { verify } from "./verifier.js";
import { Trace, BudgetExceeded, setActiveTrace } from "./trace.js";

const client = new Anthropic();
const MODEL = "claude-opus-4-7";
const MAX_STEPS = 20;
const MAX_VERIFY_ROUNDS = 2;
const BUDGET_USD = 8;

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
const cliTask = process.argv.slice(2).find(a => !a.startsWith("--"));

export async function runAgent(task, { cwd, resume } = {}) {
  setBaseDir(cwd);
  const ctx = new Context(version === "v1" ? PROMPT_V1 : PROMPT_V2, client, MODEL);
  const trace = new Trace(`task-${Date.now()}`);
  setActiveTrace(trace); // subagents report their spend back into this ledger (blog 08/10)
  if (resume) ctx.restore(resume);
  if (task) ctx.addUser(task);
  let steps = 0;
  let verifyRounds = 0;

  while (steps < MAX_STEPS) {
    steps++;
    const compressed = await ctx.maybeCompress(trace);
    if (compressed) console.error(`[compressed history · ${ctx.messages.length} messages left]`);

    // span wraps OUTSIDE withRetry: only the successful attempt has a usage to record;
    // failed retries produce none (blog 10).
    const res = await trace.span("llm", {}, () => withRetry(() => client.messages.create(ctx.toRequest(tools))));
    ctx.recordUsage(res.usage);

    // usage arrives in the response — money is only countable after it is spent, so the
    // breaker can never stop "this turn", only refuse to start the next one. Tripping at
    // 90% keeps a last breath for the checkpoint (blog 10).
    if (trace.totalUSD >= BUDGET_USD * 0.9) {
      const file = ctx.checkpoint();
      trace.summary();
      throw new BudgetExceeded(
        `spent $${trace.totalUSD.toFixed(2)}, checkpoint at ${file}, rerun with --resume=${file}`
      );
    }
    ctx.addAssistant(res.content);
    console.error(`[turn · in=${res.usage.input_tokens} out=${res.usage.output_tokens} cache_read=${res.usage.cache_read_input_tokens ?? 0}]`);

    if (res.stop_reason === "end_turn") {
      const output = res.content.find(b => b.type === "text")?.text ?? "";
      if (verifyRounds >= MAX_VERIFY_ROUNDS) {
        console.error(`[verify · rounds exhausted, unverified output — hand to human]`);
        trace.summary();
        return output;
      }
      const verdict = await verify(client, MODEL, task ?? "(resumed task)", output);
      console.error(`[verify · ${verdict.pass ? "PASS" : "FAIL: " + verdict.reason}]`);
      if (verdict.pass) { trace.summary(); return output; }
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
        const t0 = Date.now();
        // The tool span includes the gate: a human pausing at the confirmation prompt is
        // wall-clock the waterfall must show, or the trace has unexplained gaps (blog 10).
        const result = await trace.span("tool", { name: b.name }, async () => {
          const verdict = errors.length
            ? { ok: false, reason: `input validation failed: ${errors.join("; ")}` }
            : await gate(b.name, b.input);
          return verdict.ok ? await runTool(b.name, b.input) : { error: verdict.reason };
        });
        console.error(`[tool · ${b.name} · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${result.error ? "err" : "ok"}]`);
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
  trace.summary();
}

// Thin CLI shell: only run the loop when invoked directly (evals import runAgent).
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const resumeArg = process.argv.find(a => a.startsWith("--resume="));
  const resume = resumeArg?.split("=")[1];
  runAgent(resume ? cliTask : cliTask ?? "hi, who are you?", { resume })
    .then(out => { if (out != null) console.log(out); })
    .catch(err => {
      if (err instanceof BudgetExceeded) {
        console.error(`[budget · ${err.message}]`);
        process.exitCode = 2;
      } else {
        throw err;
      }
    });
}
