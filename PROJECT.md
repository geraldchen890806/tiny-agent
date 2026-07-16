# tiny-agent — Project Brief

This document has two readers at once. If you are a human, it is the project handbook: what tiny-agent is, how it is built, where each version is going, how to debug it. If you are the agent itself, this entire file is concatenated into your system prompt as standing project context: read the "Agent behavior guidelines" section as instructions addressed directly to you.

The document's length is deliberate. Anthropic's prompt cache only engages when the static prefix of a request clears a minimum cacheable size — for Opus-family models, a documented 4096 tokens at the time of writing; a shorter system prompt is silently never cached, whatever cache_control markers it carries. Shipping this brief as one long, stable block at the front of every request buys two things at once: the agent always knows what project it is working inside, and from the second turn onward the prefix is served from cache at a fraction of normal input price. Stability matters as much as size, so this brief contains nothing that varies per run.

## Project overview and philosophy

tiny-agent is a miniature AI agent that grows, version by version, from a 30-line bare loop into something you could defensibly run in production. It is the companion repository to the blog series "From useEffect to Agent Loop" (fe2agent) by Gerald Chen (chenguangliang.com), an agent-engineering introduction for frontend developers. Every post solves one concrete problem and grows one new organ onto the same small body of code; the repository is the body.

Four ranked principles govern the repo; when they conflict, the earlier one wins.

**1. No frameworks.** tiny-agent uses the raw `@anthropic-ai/sdk` Messages API and nothing else. No LangChain, no agent SDKs, no orchestration layers. The point of the series is that an agent is not magic: it is a while loop around a stateless HTTP call, plus context management, plus tools, plus the operational scar tissue production demands. A framework would hide exactly the layers the series exists to expose. When you can see every byte that goes over the wire, you can reason about cost, caching, and failure from first principles — and when you later adopt a framework, you will know what it is doing for you and what it is hiding from you.

**2. Minimal dependencies.** The `package.json` stays as thin as possible: one runtime dependency (`@anthropic-ai/sdk` — see package.json for the exact range), no dev-dependency pile, no build step. Node 20 or newer runs the source directly. Everything that could be a library is instead a small, readable function: schema validation, retries, memory retrieval, cost accounting. This is a pedagogical choice, not a recommendation for your day job; the conventions section says where the hand-rolled versions deliberately stop short.

**3. One tag per post.** Every blog post corresponds to exactly one git tag. `git checkout v0.3` puts the working tree in precisely the state it was in when post 03 ended, so a reader can board the series at any stop, run the code, and see the behavior the post describes. Tags are immutable teaching artifacts: fixes to a published version land on later versions, never by rewriting history.

**4. It runs.** `node src/agent.js "your question"` is the entire interface. Clone, `npm install`, export `ANTHROPIC_API_KEY`, run. With no argument the agent falls back to a built-in greeting prompt, so the loop is exercisable with zero setup. No config files, no CLI framework, no REPL until a version explicitly grows one. A reader should never need to study the repo before they can execute it.

## Architecture

The source lives in `src/` as three files; each owns one concern, and the boundaries between them are the boundaries the series draws between concepts.

**src/agent.js — the loop.** The orchestrator and entry point. It constructs the Anthropic client, defines the model (see the `MODEL` constant — an Opus-family model, which is what makes the caching threshold above relevant) and the base system prompt, then runs the loop: ask the Context for a request payload, call `client.messages.create`, record usage, append the assistant reply to history, and branch on `stop_reason`. On `end_turn` it prints the final text block to stdout and exits. On `tool_use` it maps every tool_use block through `runTool`, wraps each outcome as a `tool_result` block (carrying the matching `tool_use_id`, and `is_error: true` when the tool reported a failure), pushes them back into history as a user message, and loops again. Before each API call it also gives the Context a chance to compress history, logging a diagnostic line when that happens. A strict output contract holds throughout: **stdout carries only the final answer; every diagnostic goes to stderr** — keeping the agent composable in shell pipelines while staying observable.

**src/context.js — the state.** The `Context` class owns the messages array, because the central lesson of post 02 is that an LLM call is stateless and "conversation" is a client-side illusion: whatever the model appears to remember is whatever you chose to send again. All history mutation goes through three small methods — `addUser`, `addAssistant`, `addToolResults` — and nothing else touches the array. Tool results are appended with role "user": an API requirement that preserves the transcript's user/assistant cadence. `recordUsage` keeps the most recent request's input plus output token count as a live proxy for "how big is my context right now" — deliberately not a cumulative bill; it answers the question compression asks. `maybeCompress` is the pressure valve: when the tracked footprint crosses a threshold and the history is long enough to be worth splitting (both tunables are named constants at the top of the file — read the source for current values; they shift between versions), it slices off the older portion, asks the model itself to summarize it in a separate API call, and rebuilds history as a synthetic user message carrying the summary, a short synthetic assistant acknowledgment, and the untouched recent tail. The slice is taken in whole exchange pairs so a tool_use block is never orphaned from its tool_result. Finally, `toRequest` assembles the request body and places the prompt-caching breakpoint: the system prompt is sent as a content block array with `cache_control: {type: "ephemeral"}` on the system text. Because the API renders tools before system before messages, that one breakpoint caches the tool definitions and the system prompt (including this document) together.

**src/tools.js — the capabilities.** Tools are the agent's hands, and this file keeps the two halves of tool use adjacent so their relationship is impossible to miss: the declarative `tools` array (name, description, input_schema — the contract the model sees) and the `runTool` dispatcher (the implementation it never sees). Post 03's framing: the model does the dispatching, you remain the reducer — it chooses which action to emit, but every side effect runs in your code, under your validation. Accordingly, `runTool` treats the model as an untrusted client: it checks the tool name against the registry, runs the input through `validateInput` (a deliberately small hand-rolled checker for required fields and top-level types), and only then touches the filesystem, inside a try/catch. Three tools exist today: `read_file` (UTF-8 read), `write_file` (overwrite-in-place; intentionally will not create missing parent directories), and `list_dir` (non-recursive listing of name, type, and size as JSON). Every path through `runTool` returns exactly one of two shapes: `{content}` on success or `{error}` on failure. Unknown tool names, validation failures, and thrown filesystem errors all flow down the same `{error}` channel, formatted as the error code or name plus the message, so the model always receives feedback it can act on instead of the process crashing.

## The version roadmap

The repository grows one organ per post (posts 01 through 10 of the fe2agent series). Tags v0.1 through v0.3 exist today; later versions land as their posts publish, following the plan below.

**v0.1 — the bare loop (post 01, "An Agent Is Just a While Loop").** Thirty-odd lines, one file: `while (true)`, `client.messages.create`, one inlined `read_file` tool, and a two-way branch on `stop_reason`. No system prompt, no validation, no error handling — `runTool` calls `readFileSync` naked, so a missing file crashes the process. That fragility is a deliberate exhibit: v0.1 proves the essential control flow of any agent, commercial ones included, is this small. Everything after it is protection and plumbing around an unchanged core.

**v0.2 — context (post 02, "The Model Has No Memory").** The loop learns it has been re-sending its entire life story every turn. `context.js` appears: the Context class centralizes history, a summary-based compressor bounds context growth, `cache_control` lands on the system prompt, and the stderr ledger starts printing per-turn token counts so the re-render cost is visible instead of theoretical. The intent is to make state management a named, owned concern — the frontend instinct of "state lives in one store, mutations go through methods" transplanted to agent land.

**v0.3 — tools (post 03, "Let the AI dispatch, You Stay the reducer").** The toolbox extracts to `tools.js` and grows to three tools (read/write/list). Input schemas get hand-rolled validation, and failures stop crashing the process: every tool outcome is normalized to `{content}` or `{error}`, and errors return to the model through the API's `is_error` channel as feedback it can react to. The intent is separation of powers — the model chooses actions, your code executes them under contract — plus the discovery that a tool description is prompt engineering, not documentation.

**v0.4 — prompt (post 04, "Prompt Is the New CSS").** No new machinery; this version ships a rewritten, structured system prompt alongside the old one-liner so the reader can run the same tasks under both and diff the behavior. The point: a prompt is a declarative, cascading behavior layer with no devtools — one changed sentence yields a visibly different agent, instructions dilute as they pile up, structure beats volume.

**v0.5 — memory (post 05, "Context Is RAM, Memory Is Disk").** Context dies with the process; memory survives it. The agent gains a markdown memory file plus two new tools, `save_memory` and `search_memory`, with naive keyword retrieval — no embeddings, no vector store. The intent is persistence as lazy loading: write facts down during a session, retrieve and re-inject only the relevant lines next session, and notice that a plain text file plus dumb search covers a surprising share of what "agent memory" products sell.

**v0.6 — fault tolerance (post 06, "Errors Are Scheduled Work").** Two failure classes, two treatments. Mechanical failures (network, rate limits, overload) get `withRetry` with exponential backoff plus a hard `MAX_STEPS` brake on the loop. Semantic failures — the model confidently declaring "done" when the work is not done — get a verifier: an independent check in an isolated context, because the context that produced a mistake will happily grade its own homework. The intent: move from frontend's error boundaries to agent land's assumption that errors are scheduled work, not exceptions.

**v0.7 — permissions (post 07, "Pop a window.confirm at the AI").** Retrying correctly is not the same as being allowed to act. A danger-level table classifies tools, a PreToolUse-style confirmation gate interposes before risky calls (naming concrete consequences, not just the tool name), denials flow back to the model as information it can plan around, and every decision lands in a JSONL audit log. The intent: permission is a spectrum, not a switch, and human-in-the-loop is a designed component, not an apology.

**v0.8 — subagents (post 08, "A Subagent Is Just a Web Worker").** The agent gains `spawnSubagent` and a `delegate_task` tool: a child loop with a fresh, isolated context that receives only a written brief and returns only a result, keeping the parent's context lean. The intent is context isolation and its price: a task description is a lossy, schema-free serialization, the child inherits none of the parent's history, and every assumption the brief omits gets filled in by guesswork. Child-loop token accounting keeps the cost of delegation honest.

**v0.9 — evals (post 09, "Flaky Isn't a Bug Anymore, It's the Physics").** An `evals/` directory appears: a case set drawn from real past failures, run multiple times per case, scored by pass rate rather than exact match, with an LLM judge where string equality is meaningless. The intent is the testing-mindset migration: identical input legally produces different output, so a single green run proves nothing, assertions become distributions, and the eval set becomes your scar collection — every incident donates a case.

**v1.0 — production (post 10, "From Sweating the Bundle to Sweating the Tokens").** The operational organs: `trace.js` writes a cost ledger correlating every API call with its tokens and dollars, a multi-layer budget breaker (per-turn, per-task, per-dollar) stops runaway loops before they become invoices, and checkpoint/`--resume` makes long tasks interruptible. Deployment guidance favors spawn-per-task over long-running processes: born clean, either finish or roll back, leave no debris. The intent is the craft frontend applies to bundle size, pointed at tokens.

## Coding conventions

These conventions are load-bearing; follow them when contributing or generating code here.

- **ESM everywhere.** `"type": "module"` is set; use `import`/`export`, never `require`. Node built-ins take the `node:` prefix (e.g. `node:fs`).
- **Two-space indentation**, double-quoted strings, semicolons, trailing commas in multiline literals. Match the surrounding file.
- **Small functions, flat files.** Each file reads top to bottom as a narrative. Functions stay short enough to quote in a blog post; if a helper needs a subheading, it is too big. No classes except where identity-plus-state earns one (Context).
- **Teaching beats robustness.** Code optimizes for being understood on first read, then for correctness, then — distantly — for generality. Edge cases the series has not reached are left visibly unhandled rather than half-handled. Cleverness is a defect.
- **Deliberately hand-written.** Anything a library would abstract is written out: the schema validator checks only required fields and top-level types by design, growing only when a post needs it to; retry, memory search, and tracing follow the same rule in their versions. Do not introduce zod, ajv, p-retry, or similar — swapping hand-rolled parts for dependencies defeats the repo's purpose.
- **One error shape.** Every tool implementation returns `{content}` on success or `{error}` on failure — never throws across the tool boundary, never returns a bare string, never invents a third shape. The loop maps `{error}` to a `tool_result` with `is_error: true` so failures reach the model as structured feedback. New tools must honor this contract.
- **Constants at the top.** Tunable numbers (compression thresholds, retained-turn counts, token caps) are SCREAMING_CASE constants at the top of the file that owns them. Documentation refers to them by name, not by value, because the values move between versions.
- **stdout is the product, stderr is the telemetry.** Never print diagnostics to stdout; never print the answer to stderr.

## Agent behavior guidelines

These rules address you, the agent, whenever this brief rides in your system prompt.

- **Read before you write.** Never call `write_file` on a path you have not read this session, unless `list_dir` shows the file does not exist yet. `write_file` replaces the whole file; writing blind destroys content you never saw.
- **Make the minimal change.** When editing an existing file, reproduce it byte-for-byte except for the region the task requires you to change. Do not reformat, reorder, rename, or "improve" untouched code or prose. If a larger change seems warranted, say so in your answer instead of doing it.
- **Report what you changed.** `write_file` returns the byte count written and the resolved path; repeat both in your final answer with a one-line description of the change, so the human can audit you cheaply.
- **Say "I don't know."** If the files you can read do not contain the answer, state that plainly. Do not guess file contents, invent paths, or fabricate output. An honest gap is useful; a confident fabrication is expensive.
- **Respect tool limits.** `list_dir` is non-recursive — walk trees level by level. `write_file` will not create parent directories — a missing parent returns an error; surface it rather than assuming success.
- **Treat tool errors as information.** A validation error means your call was malformed — fix the input shape. An unknown-tool error means you invented a name — use only the tools you were given. If the same call fails twice for the same reason, change approach or report the blocker.
- **Keep the final answer clean.** Your last message is the program's stdout. Lead with the outcome, stay concise, and do not narrate your tool calls in it.

## Cost and observability notes

tiny-agent's observability is a stderr ledger, one line per API turn:

`[turn · in=<input_tokens> out=<output_tokens> cache_read=<cache_read_input_tokens>]`

`in` is the input tokens billed at the normal rate this turn — the uncached remainder, not the whole prompt. `out` is output tokens. `cache_read` is how much of the prompt came from cache at roughly a tenth of normal input price; true prompt size is the cached and uncached parts summed. When compression fires, a second line reports:

`[compressed history · <n> messages left]`

Watching these two lines teaches the core cost intuitions faster than any dashboard. `in` grows every turn because the loop re-sends the whole conversation — post 02's "full re-render with no diff". A healthy `cache_read` from turn two onward roughly equals the static prefix (tool schemas plus system prompt plus this brief).

How the caching works: Anthropic's prompt cache is a strict prefix match over the exact bytes of the rendered request, in the order tools, then system, then messages. tiny-agent sets one `cache_control: {type: "ephemeral"}` breakpoint on the system text block, which caches tools and system together; the growing messages array after it is intentionally uncached. The first request pays a small write premium to create the entry; later requests within the cache's time-to-live read it at a steep discount. Everything here follows one rule: **stable content first, volatile content last.** The tool list and system prompt never change during a session, so they live at the front where a hit can cover them; anything that varies — the question, tool results — belongs after the breakpoint, because any changed byte invalidates all cached content downstream of it. Caches are also model-scoped, and the minimum cacheable prefix differs by model family; on the Opus-family model this repo uses, a prefix under the documented minimum is silently ignored — which is why this brief is as long as it is.

## Troubleshooting FAQ

**Q: On v0.1, asking for a missing file crashes the whole process with ENOENT. Bug?**
Intentional. v0.1 has no error handling: `readFileSync` throws, nothing catches it, Node dies with a stack trace. The crash is the cliffhanger post 03 resolves — on v0.3 or later the same mistake comes back to the model as an `is_error` tool result it can recover from.

**Q: The ledger shows cache_read=0 on every turn. What do I check?**
In order: (1) A session's first turn always shows 0 — it writes the cache; reads start on turn two. (2) The prefix must clear the model's minimum cacheable size; if the system prompt is short (say, this brief was removed), an Opus-family model silently will not cache it. (3) The prefix must be byte-identical between turns — any mid-session edit to the system string or tools invalidates it. (4) Cache entries expire after a few idle minutes; after a long pause the next request rewrites instead of reads. (5) Switching the `MODEL` constant abandons the old model's cache.

**Q: Compression never triggers in my sessions.**
`maybeCompress` requires both conditions: the tracked token footprint of the latest turn must cross the threshold constant, and the history must contain more messages than the retained tail size (both constants at the top of `src/context.js`). Short chats fail the first; a session dominated by one huge file read can pass the first while failing the second. Log `ctx.totalTokens` and `ctx.messages.length` before the check to see which gate is closed.

**Q: The API returns 400 complaining about message roles or tool_use ids.**
Three invariants cover almost every case: the first message must have role "user"; every `tool_use` block in an assistant message must be answered by a `tool_result` block (matching `tool_use_id`) in the user message that immediately follows; and all results for one assistant turn ride together in that single user message. You will usually hit this after hand-editing history — dropping the compressor's synthetic assistant acknowledgment, or slicing the array so a tool_use loses its result. Keep exchange pairs intact when touching `ctx.messages`.

**Q: write_file fails with ENOENT even though the content is fine.**
The parent directory does not exist. The tool deliberately does not mkdir — implicit directory creation is exactly the silent side effect the permissions post argues against. Create the directory yourself (or, as the agent, report the missing parent) and retry.

**Q: The API returns 404 or "model not found" on the first call.**
The `MODEL` constant in `src/agent.js` names a model your key cannot access, or the id drifted since that tag was published. Swap in any current model id your account can use; nothing else in the loop cares.

**Q: Authentication errors on startup.**
The SDK reads `ANTHROPIC_API_KEY` from the environment; the client is constructed with no arguments on purpose. Export the key in the shell that runs the agent. Never hardcode keys — this repo is public.

**Q: I piped the agent's output to a file and the token logs disappeared.**
Working as designed: the answer goes to stdout, diagnostics go to stderr. `node src/agent.js "..." > answer.txt` captures the answer only; add `2> trace.log` to keep the ledger too.

**"Two runAgent calls at once and the cost ledger looks wrong" (v0.9+).** runAgent is not concurrency-safe: the active trace is a module-level singleton, so parallel runs overwrite each other's ledger and subagent spend lands in the wrong bill. Run tasks serially (the eval harness does), or give each run its own process.

**"I resumed a checkpoint and the agent's personality changed" (v1.0).** A checkpoint stores messages only, not the prompt variant. Resuming under a different --prompt flag silently swaps the system prompt mid-task (and invalidates the cached prefix). Pass the same --prompt you started with.

## Roadmap beyond v1.0

The mainline ends at v1.0; the repo does not.

**The moonshot branch.** A demo branch replacing the Anthropic client with an OpenAI-compatible one pointed at domestic Chinese providers (Moonshot/Kimi, DeepSeek). The skeleton is isomorphic; the port is two moves — swap the client layer via the `openai` package with a custom `baseURL`, then map field names (`stop_reason: "end_turn"` versus `finish_reason: "stop"`, `tool_use` blocks versus `tool_calls`, user-role `tool_result` blocks versus `role: "tool"` messages). It exists so readers can see which provider differences are shape and which are capability. Open an issue on GitHub (geraldchen890806/tiny-agent) to bump its priority.

**MCP side story.** A bonus post treating the Model Context Protocol as agent-land's npm: tools stop being hand-written and start being installed, and every old package-management problem — versioning, trust, supply chain — comes back with them. tiny-agent will grow a minimal MCP client to make the tradeoffs concrete.

**Agent UI side story.** The agent eventually needs a face: a chat window, streaming output, loading states for tool calls, a real button for the v0.7 confirmation gate. The series ends where its readers started — back in frontend, on home turf.

Contributions are welcome under the MIT license, provided the four principles stay intact: no frameworks, minimal dependencies, one tag per post, and it runs.
