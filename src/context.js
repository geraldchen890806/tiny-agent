const COMPRESS_THRESHOLD_TOKENS = 12000;
const KEEP_RECENT_TURNS = 4;

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { recentNotes } from "./memory.js";

export class Context {
  constructor(baseSystem, client, model) {
    this.baseSystem = baseSystem;
    this.messages = [];
    this.client = client;
    this.model = model;
    this.totalTokens = 0;
  }

  addUser(content) {
    this.messages.push({ role: "user", content });
  }

  addAssistant(contentBlocks) {
    this.messages.push({ role: "assistant", content: contentBlocks });
  }

  addToolResults(toolResults) {
    this.messages.push({ role: "user", content: toolResults });
  }

  recordUsage(usage) {
    this.totalTokens = usage.input_tokens + usage.output_tokens;
  }

  async maybeCompress(trace) {
    if (this.totalTokens < COMPRESS_THRESHOLD_TOKENS) return false;
    if (this.messages.length <= KEEP_RECENT_TURNS * 2) return false;

    // The cut must not land on a user message carrying tool_results: once its tool_use
    // is compressed away the tool_result is an orphan and the API 400s. Walk earlier to
    // a safe boundary (an assistant message, or a plain user message).
    let cut = this.messages.length - KEEP_RECENT_TURNS * 2;
    const isToolResultUser = m => m.role === "user" && Array.isArray(m.content)
      && m.content.some(b => b?.type === "tool_result");
    while (cut > 0 && isToolResultUser(this.messages[cut])) cut--;
    if (cut <= 0) return false;

    const toCompress = this.messages.slice(0, cut);
    const recent = this.messages.slice(cut);

    // The summary mini-call burns real tokens too. Long tasks compress the most, so a
    // breaker that skips this line is at its least accurate exactly when needed (blog 10).
    const create = () => this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      system: "Summarize this conversation history into one paragraph. Keep tool calls, file paths, and any facts the next turn might need. No preamble.",
      messages: [{ role: "user", content: JSON.stringify(toCompress) }],
    });
    const summaryRes = trace ? await trace.span("llm", { kind: "compress" }, create) : await create();
    const summary = summaryRes.content.find(b => b.type === "text")?.text ?? "";

    this.messages = [
      { role: "user", content: `[Summary of earlier conversation]\n${summary}` },
      // Only pad the synthetic assistant when recent opens with a user message —
      // strict user/assistant alternation is an API-level 400 in both directions.
      ...(recent[0].role === "user"
        ? [{ role: "assistant", content: "Understood, continuing from here." }]
        : []),
      ...recent,
    ];
    return true;
  }

  checkpoint() {
    mkdirSync("checkpoints", { recursive: true });
    const file = `checkpoints/task-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify({ messages: this.messages }, null, 2), "utf-8");
    return file;
  }

  restore(file) {
    this.messages = JSON.parse(readFileSync(file, "utf-8")).messages;
    // A checkpoint usually means the conversation was already big. Seed the counter at
    // the threshold so the very first resumed turn re-evaluates compression instead of
    // waiting for one full-price round trip to relearn the size.
    this.totalTokens = COMPRESS_THRESHOLD_TOKENS;
  }

  toRequest(tools) {
    return {
      model: this.model,
      max_tokens: 1024,
      // Two blocks: the stable persona+brief up front (cached), volatile memory behind
      // it (uncached) — the moving block never invalidates the cached prefix (blog 02).
      system: [
        { type: "text", text: this.baseSystem, cache_control: { type: "ephemeral" } },
        { type: "text", text: `## Recent memory\n${recentNotes()}` },
      ],
      tools,
      messages: this.messages,
    };
  }
}
