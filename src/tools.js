import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { remember, recall } from "./memory.js";
import { spawnSubagent } from "./subagent.js";
import { resolve } from "node:path";

export const tools = [
  {
    name: "read_file",
    description: "Read a file from the local filesystem and return its content as a UTF-8 string.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "absolute or relative path to the file" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write UTF-8 content to a file, overwriting if it exists. Creates parent directory only if it already exists; will not mkdir.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "absolute or relative path where the file should be written" },
        content: { type: "string", description: "the UTF-8 text to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_dir",
    description: "List entries in a directory. Returns a JSON array of {name, type: 'file' | 'dir', size} objects. Non-recursive.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "absolute or relative path to the directory" },
      },
      required: ["path"],
    },
  },

  {
    name: "save_memory",
    description: "Persist a durable fact or rule for future sessions. Save conclusions and constraints, not process. One fact per call.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "the fact to remember" } },
      required: ["text"],
    },
  },
  {
    name: "search_memory",
    description: "Search long-term memory with space-separated keywords. Use when the task may depend on rules or facts from earlier sessions. Returns top 3 matching notes.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "keywords, separated by spaces" } },
      required: ["query"],
    },
  },

  {
    name: "delegate_task",
    description: "Delegate a self-contained subtask to a fresh subagent. It sees ONLY your brief—no conversation history. Write the brief in three parts: task, constraints, expected output format.",
    input_schema: {
      type: "object",
      properties: {
        brief: { type: "string", description: "Complete instructions. The subagent knows nothing you don't write here." },
      },
      required: ["brief"],
    },
  },
];

export const toolByName = Object.fromEntries(tools.map(t => [t.name, t]));

export function validateInput(schema, input) {
  const errors = [];
  for (const key of schema.required ?? []) {
    if (!(key in input)) errors.push(`missing required field: ${key}`);
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (!(key in input)) continue;
    const actual = typeof input[key];
    if (actual !== spec.type) errors.push(`field '${key}' should be ${spec.type}, got ${actual}`);
  }
  return errors;
}

export async function runTool(name, input) {
  const spec = toolByName[name];
  if (!spec) return { error: `unknown tool: ${name}` };

  const errors = validateInput(spec.input_schema, input);
  if (errors.length) return { error: `input validation failed: ${errors.join("; ")}` };

  try {
    if (name === "read_file") {
      return { content: readFileSync(input.path, "utf-8") };
    }
    if (name === "write_file") {
      writeFileSync(input.path, input.content, "utf-8");
      return { content: `wrote ${input.content.length} bytes to ${resolve(input.path)}` };
    }
    if (name === "save_memory") {
      return { content: remember(input.text) };
    }
    if (name === "delegate_task") {
      return { content: await spawnSubagent(input.brief, tools) };
    }
    if (name === "search_memory") {
      const hits = recall(input.query);
      return { content: hits.length ? hits.join("\n\n---\n\n") : "no matching notes" };
    }
    if (name === "list_dir") {
      const entries = readdirSync(input.path).map(name => {
        const full = resolve(input.path, name);
        const s = statSync(full);
        return { name, type: s.isDirectory() ? "dir" : "file", size: s.size };
      });
      return { content: JSON.stringify(entries, null, 2) };
    }
    return { error: `tool '${name}' has no handler` };
  } catch (err) {
    return { error: `${err.code ?? err.name}: ${err.message}` };
  }
}
