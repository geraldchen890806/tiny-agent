import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
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
];

const toolByName = Object.fromEntries(tools.map(t => [t.name, t]));

function validateInput(schema, input) {
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

export function runTool(name, input) {
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
