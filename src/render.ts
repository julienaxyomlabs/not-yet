// The pause, as text. One renderer for the terminal, the Claude Code prompt
// and the log. Stark: a name, what is about to happen, a few facts, a choice.
import type { Context, PolicyResult } from "./types.js";
import { explain } from "./policy.js";

const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));

export function renderPause(raw: string, policy: PolicyResult, ctx: Context, opts: { ansi?: boolean; width?: number } = {}): string {
  const a = opts.ansi ?? false;
  const dim = (s: string) => (a ? `\x1b[2m${s}\x1b[0m` : s);
  const bold = (s: string) => (a ? `\x1b[1m${s}\x1b[0m` : s);
  const lines: string[] = [];
  lines.push("");
  lines.push(bold("NOT YET"));
  lines.push("");
  lines.push(dim(policy.decision === "deny" ? "agent tried to:" : "agent wants to:"));
  lines.push("");
  for (const l of wrap(ctx.headline, opts.width ?? 64)) lines.push("  " + bold(l));
  lines.push("");
  const facts = [...ctx.facts, { label: "reversible", value: ctx.reversible }];
  const w = Math.max(...facts.map((f) => f.label.length)) + 4;
  for (const f of facts) lines.push(dim(pad(f.label, w)) + f.value);
  lines.push("");
  lines.push(dim("because ") + policy.reasons.map((r) => `${r}${dim(" — " + explain(r))}`).join(dim(", ")));
  lines.push("");
  lines.push(policy.decision === "deny" ? dim("denied by policy. no human can approve this from here.") : `${bold("[ approve ]")}  ${bold("[ reject ]")}`);
  lines.push("");
  return lines.join("\n");
}

// what the agent receives when a human says no — structured, so it can replan
export function rejection(raw: string, policy: PolicyResult, by: string) {
  return { status: "rejected", by, action: raw, reasons: policy.reasons, message: `NOT YET — a human declined this action. It was not executed. Do not retry it unchanged; explain what you wanted to do and propose an alternative.` };
}

function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const line of s.split("\n")) {
    let cur = "";
    for (const word of line.split(" ")) {
      if ((cur + " " + word).trim().length > width && cur) { out.push(cur); cur = word; } else cur = (cur ? cur + " " : "") + word;
    }
    out.push(cur);
  }
  return out;
}
