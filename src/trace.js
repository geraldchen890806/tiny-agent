import { appendFileSync, mkdirSync } from "node:fs";

// Opus-family list price, per million tokens: input $5 / output $25; cache reads bill
// at ~0.1x input, cache writes at ~1.25x (blog 02 / blog 10).
const PRICE_PER_M = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

export class BudgetExceeded extends Error {}

// The one live trace of this process. Subagents (blog 08) report their spend back into
// it — a dollar breaker that only watches the main loop misses half the fleet's bill.
let active = null;
export function setActiveTrace(t) { active = t; }
export function activeTrace() { return active; }

export class Trace {
  constructor(taskId) {
    mkdirSync("traces", { recursive: true });
    this.file = `traces/${taskId}.jsonl`;
    this.cost = { input: 0, output: 0, cache: 0 };
    this.steps = 0;
  }

  async span(type, meta, fn) {
    const t0 = Date.now();
    const result = await fn();
    const span = { ts: t0, type, duration: Date.now() - t0, ...meta };
    if (type === "llm") {
      const u = result.usage;
      span.in = u.input_tokens; span.out = u.output_tokens;
      span.cacheRead = u.cache_read_input_tokens ?? 0;
      span.cacheWrite = u.cache_creation_input_tokens ?? 0;
      this.cost.input += span.in * PRICE_PER_M.input / 1e6;
      this.cost.output += span.out * PRICE_PER_M.output / 1e6;
      this.cost.cache += span.cacheRead * PRICE_PER_M.cacheRead / 1e6
                       + span.cacheWrite * PRICE_PER_M.cacheWrite / 1e6;
    }
    this.steps += 1;
    appendFileSync(this.file, JSON.stringify(span) + "\n");
    return result;
  }

  // Spend that happened outside this process's spans — e.g. a subagent's own loop.
  recordExternal(inTok, outTok) {
    this.cost.input += inTok * PRICE_PER_M.input / 1e6;
    this.cost.output += outTok * PRICE_PER_M.output / 1e6;
    appendFileSync(this.file, JSON.stringify({ ts: Date.now(), type: "subagent", in: inTok, out: outTok }) + "\n");
  }

  get totalUSD() { return this.cost.input + this.cost.output + this.cost.cache; }

  summary() {
    const f = n => `$${n.toFixed(2)}`;
    console.error(`[trace · steps=${this.steps} · input=${f(this.cost.input)}` +
      ` output=${f(this.cost.output)} cache=${f(this.cost.cache)}` +
      ` · total=${f(this.totalUSD)}]`);
  }
}
