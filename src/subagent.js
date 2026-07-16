import Anthropic from "@anthropic-ai/sdk";
import { runTool } from "./tools.js";
import { withRetry } from "./agent.js";

// tools.js and this file import each other (delegate_task -> spawnSubagent -> runTool).
// ESM tolerates the cycle as long as neither module calls the other at top level —
// both calls happen inside function bodies, so the bindings are ready by then.

const client = new Anthropic();
const MODEL = "claude-opus-4-7";

export async function spawnSubagent(brief, tools, { maxSteps = 10 } = {}) {
  // No spawning grandchildren, and no write tools either: the child loop runs with no
  // confirmation gate, so it leaves home with a read-only toolbox (blog 07 / blog 08).
  const childTools = tools.filter(t => !["delegate_task", "write_file", "save_memory"].includes(t.name));
  const messages = [{ role: "user", content: brief }];
  let steps = 0, inTok = 0, outTok = 0;

  while (steps < maxSteps) {
    steps++;
    const res = await withRetry(() => client.messages.create({ model: MODEL, max_tokens: 1024, tools: childTools, messages }));
    inTok += res.usage.input_tokens;
    outTok += res.usage.output_tokens;
    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason === "end_turn") {
      console.error(`[subagent · steps=${steps} in=${inTok} out=${outTok}]`);
      return res.content.find(b => b.type === "text")?.text ?? "";
    }
    if (res.stop_reason === "tool_use") {
      const toolResults = [];
      for (const b of res.content.filter(b => b.type === "tool_use")) {
        const result = await runTool(b.name, b.input);
        toolResults.push({
          type: "tool_result", tool_use_id: b.id,
          content: result.error ?? result.content, is_error: !!result.error,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
  }
  console.error(`[subagent · steps=${steps} in=${inTok} out=${outTok}]`);
  return `[subagent aborted: hit maxSteps=${maxSteps}]`;
}
