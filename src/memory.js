import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Memory follows the same baseDir as the file tools: during evals it must land in the
// scratch workspace, not in the real repo — otherwise cases leak into each other and
// eval junk crowds the agent's actual long-term notes.
let baseDir = ".";
export function setMemoryBaseDir(dir) { baseDir = dir ?? "."; }
const memDir = () => resolve(baseDir, "memory");
const memFile = () => resolve(memDir(), "notes.md");

const RECENT_N = 5;
const TOP_K = 3;

export function remember(text) {
  mkdirSync(memDir(), { recursive: true });
  const entry = `\n## ${new Date().toISOString().slice(0, 10)}\n${text.trim()}\n`;
  appendFileSync(memFile(), entry, "utf-8");
  return `remembered (${text.trim().length} chars)`;
}

function loadEntries() {
  if (!existsSync(memFile())) return [];
  return readFileSync(memFile(), "utf-8").split(/\n(?=## )/).map(s => s.trim()).filter(Boolean);
}

export function recall(query) {
  const terms = query.toLowerCase().split(/[\s,，。、/]+/).filter(t => t.length > 1);
  if (!terms.length) return [];
  return loadEntries()
    .map(entry => ({
      entry,
      score: terms.reduce((n, t) => n + (entry.toLowerCase().includes(t) ? 1 : 0), 0),
    }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map(e => e.entry);
}

export function recentNotes(n = RECENT_N) {
  return loadEntries().slice(-n).join("\n\n");
}
