// Rule checks first (free, deterministic), LLM verdict second — and the LLM call is a
// fresh, history-free request on purpose: a verifier that sees the worker's struggle
// starts grading the effort instead of the result (blog 06).
const RULES = [
  { name: "output_not_empty", check: (task, output) => output.trim().length > 0 },
];

export async function verify(client, model, task, output) {
  for (const rule of RULES) {
    if (!rule.check(task, output)) return { pass: false, reason: `rule failed: ${rule.name}` };
  }
  const res = await client.messages.create({
    model,
    max_tokens: 256,
    system: "You are a strict verifier. Judge ONLY whether the output fulfills the task. First line: PASS or FAIL. Second line: one-sentence reason.",
    messages: [{
      role: "user",
      content: `<task>\n${task}\n</task>\n\n<output>\n${output}\n</output>`,
    }],
  });
  const text = res.content.find(b => b.type === "text")?.text ?? "";
  const pass = text.trim().toUpperCase().startsWith("PASS");
  return { pass, reason: text.split("\n").slice(1).join(" ").trim() };
}
