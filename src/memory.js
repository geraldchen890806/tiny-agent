import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";

const NOTES_PATH = "memory/notes.md";
const RECENT_N = 5;
const TOP_K = 3;

export function remember(text) {
  mkdirSync("memory", { recursive: true });
  const entry = `\n## ${new Date().toISOString().slice(0, 10)}\n${text.trim()}\n`;
  appendFileSync(NOTES_PATH, entry, "utf-8");
  return `remembered (${text.trim().length} chars)`;
}

function loadEntries() {
  if (!existsSync(NOTES_PATH)) return [];
  return readFileSync(NOTES_PATH, "utf-8").split(/\n(?=## )/).map(s => s.trim()).filter(Boolean);
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
