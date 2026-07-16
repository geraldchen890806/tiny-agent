import Anthropic from "@anthropic-ai/sdk";
import { Context } from "./context.js";
import { tools, runTool } from "./tools.js";
import { PROMPT_V1, PROMPT_V2 } from "./prompts.js";

const client = new Anthropic();
const MODEL = "claude-opus-4-7";

const promptArg = process.argv.find(a => a.startsWith("--prompt="));
const version = promptArg?.split("=")[1] ?? "v2";
const task = process.argv.slice(2).find(a => !a.startsWith("--"));
const ctx = new Context(version === "v1" ? PROMPT_V1 : PROMPT_V2, client, MODEL);

async function main(userInput) {
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

main(task ?? "hi, who are you?");
