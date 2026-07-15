import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

const client = new Anthropic();
const MODEL = "claude-opus-4-7";
const tools = [{
  name: "read_file",
  description: "Read a file from the local filesystem and return its content as a string.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "absolute or relative path" } },
    required: ["path"],
  },
}];

function runTool(name, input) {
  if (name === "read_file") return readFileSync(input.path, "utf-8");
  return `unknown tool: ${name}`;
}

async function main(userInput) {
  const messages = [{ role: "user", content: userInput }];
  while (true) {
    const res = await client.messages.create({ model: MODEL, max_tokens: 1024, tools, messages });
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "end_turn") { console.log(res.content.find(b => b.type === "text")?.text ?? ""); return; }
    if (res.stop_reason === "tool_use") {
      const toolResults = res.content.filter(b => b.type === "tool_use").map(b => ({
        type: "tool_result", tool_use_id: b.id, content: runTool(b.name, b.input),
      }));
      messages.push({ role: "user", content: toolResults });
    }
  }
}

main(process.argv[2] ?? "hi, who are you?");
