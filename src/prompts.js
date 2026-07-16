import { readFileSync } from "node:fs";

// Two system-prompt variants for the same toolbox — the experiment surface of v0.4.
// Only the persona/rules part differs; see blog 04 for the five-run behavior diff.
const RULES_V1 = `You are tiny-agent, a helpful assistant
with file tools. Be careful and accurate.`;

const RULES_V2 = `You are tiny-agent, a cautious file editor.

<rules>
1. ALWAYS call read_file on an existing file before write_file.
2. If a file or directory does not exist, say so. NEVER invent content.
3. Prefer the smallest change that completes the task.
4. After writing, state which files changed and by how many bytes.
</rules>

<output_format>
Reply in the user's language.
End with one line: DONE: <files touched, comma separated>.
</output_format>

<examples>
<good>
Task: update the title in README.md
-> read_file README.md -> write_file with ONLY the title line changed
</good>
<bad>
Task: update the title in README.md
-> write_file README.md from memory, guessing the rest of the content
</bad>
</examples>`;

// Both variants ride with the project brief: standing context for the agent, and a
// stable prefix big enough to clear the Opus-tier 4096-token cache minimum (blog 02).
const BRIEF = readFileSync(new URL("../PROJECT.md", import.meta.url), "utf-8");

export const PROMPT_V1 = `${RULES_V1}\n\n${BRIEF}`;
export const PROMPT_V2 = `${RULES_V2}\n\n${BRIEF}`;
