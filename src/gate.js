import { createInterface } from "node:readline/promises";
import { appendFileSync, existsSync, statSync } from "node:fs";

// The whitelist: tools not in this table — including ones the model invents — fall
// through `?? "deny"`. The other half of the whitelist's price: every new tool must be
// registered here, or it silently 403s from then on (blog 07).
const LEVELS = {
  read_file: "allow",
  list_dir: "allow",
  search_memory: "allow",   // v0.5 retrieval, read-only, pass
  write_file: "confirm",
  save_memory: "confirm",   // v0.5 memory write, hits disk, through the gate
  delegate_task: "allow",   // v0.8 delegation is a choice, not a side effect — and the
                            // child toolbox is read-only, so nothing to confirm here
};

function audit(entry) {
  appendFileSync("gate-audit.jsonl",
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

function consequence(name, input) {
  if (name === "write_file") {
    return existsSync(input.path)
      ? `overwrite ${input.path} (${statSync(input.path).size} existing bytes will be lost)`
      : `create ${input.path} (${input.content.length} bytes)`;
  }
  if (name === "save_memory") {
    return `append a ${input.text.length}-char note to memory/notes.md`;
  }
  return `run ${name}(${JSON.stringify(input)})`;
}

export async function gate(name, input) {
  const level = LEVELS[name] ?? "deny";
  if (level === "allow") {
    audit({ tool: name, level, decision: "auto-allow" });
    return { ok: true };
  }
  if (level === "deny") {
    audit({ tool: name, level, decision: "auto-deny" });
    return { ok: false, reason: `tool '${name}' is not permitted by policy` };
  }
  // Non-interactive runs (evals, CI) can lift confirm-level gates explicitly; the audit
  // line still records that it was an automatic pass, not a human one (blog 09).
  const what = consequence(name, input);
  if (process.env.TINY_AGENT_AUTO_APPROVE === "1") {
    audit({ tool: name, level, what, decision: "auto-allow(env)" });
    return { ok: true };
  }
  // No TTY and no explicit approval: deny out loud instead of reading EOF as a silent
  // "no" — a piped run should learn why every write was refused.
  if (!process.stdin.isTTY) {
    audit({ tool: name, level, what, decision: "denied(non-interactive)" });
    return { ok: false, reason: `non-interactive session, set TINY_AGENT_AUTO_APPROVE=1 to allow: ${what}` };
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = (await rl.question(`⚠ about to ${what} — type yes to continue: `)).trim();
  rl.close();
  const ok = answer === "yes";
  audit({ tool: name, level, what, decision: ok ? "allowed" : "denied" });
  return ok ? { ok: true } : { ok: false, reason: `user denied: ${what}` };
}
