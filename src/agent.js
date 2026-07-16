import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { Context } from "./context.js";
import { tools, runTool } from "./tools.js";

const client = new Anthropic();
const MODEL = "claude-opus-4-7";
const PERSONA = "You are tiny-agent, a minimal AI agent that uses tools when helpful. Be concise.";
// The project brief rides along in the system prompt: standing project context for the
// agent, and enough stable prefix to clear the Opus-tier 4096-token minimum cacheable
// length — a shorter prefix silently never caches (see blog 02).
const SYSTEM = PERSONA + "\n\n" + readFileSync(new URL("../PROJECT.md", import.meta.url), "utf-8");

async function main(userInput) {
  const ctx = new Context(SYSTEM, client, MODEL);
  ctx.addUser(userInput);

  while (true) {
    const compressed = await ctx.maybeCompress();
    if (compressed) console.error(`[compressed history · ${ctx.messages.length} messages left]`);

    const res = await client.messages.create(ctx.toRequest(tools));
    ctx.recordUsage(res.usage);
    ctx.addAssistant(res.content);
    console.error(`[turn · in=${res.usage.input_tokens} out=${res.usage.output_tokens} cache_read=${res.usage.cache_read_input_tokens ?? 0}]`);

    if (res.stop_reason === "end_turn") {
      console.log(res.content.find(b => b.type === "text")?.text ?? "");
      return;
    }
    if (res.stop_reason === "tool_use") {
      const toolResults = res.content.filter(b => b.type === "tool_use").map(b => {
        const result = runTool(b.name, b.input);
        return {
          type: "tool_result",
          tool_use_id: b.id,
          content: result.error ?? result.content,
          is_error: !!result.error,
        };
      });
      ctx.addToolResults(toolResults);
    }
  }
}

main(process.argv[2] ?? "hi, who are you?");
