// Claude Code PreToolUse hook. stdin: the tool call. stdout: a decision, or
// nothing at all for harmless work (so Claude Code's own permission flow is
// untouched). Hooks have no terminal, so the human decision happens either
// in a `notyet watch` terminal, or — if none is open — in Claude Code's own
// permission prompt, which we hand the NOT YET block to.
import { normalize } from "./normalize.js";
import { evaluate } from "./policy.js";
import { enrich } from "./context.js";
import { renderPause, rejection } from "./render.js";
import { append, newId, readAll } from "./log.js";
import { watcherAlive, writePending, waitForDecision, clearPending } from "./pending.js";
import type { Event, ToolCall } from "./types.js";

type HookInput = { session_id?: string; cwd?: string; tool_name: string; tool_input: Record<string, unknown>; tool_use_id?: string; hook_event_name?: string };

const HOOK_BUDGET_MS = Number(process.env.NOTYET_HOOK_BUDGET_MS || 570_000);   // under Claude Code's 600s default

export async function readStdin(): Promise<string> { const chunks: Buffer[] = []; for await (const c of process.stdin) chunks.push(c as Buffer); return Buffer.concat(chunks).toString("utf8"); }

function out(decision: "allow" | "deny" | "ask", reason: string) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }) + "\n");
}

export async function runHook(input: HookInput): Promise<void> {
  const call: ToolCall = { tool: input.tool_name, input: input.tool_input ?? {}, cwd: input.cwd, session_id: input.session_id, tool_use_id: input.tool_use_id };
  const action = normalize(call);
  const policy = evaluate(action);
  if (policy.decision === "allow") return;          // silent: not our business

  const ctx = await enrich(action, input.cwd);
  const base: Event = {
    run_id: input.session_id ? `run_${input.session_id.slice(0, 12)}` : newId("run"), event_id: newId("evt"), timestamp: new Date().toISOString(),
    tool: input.tool_name, raw_action: action.raw, normalized_action: action, policy_decision: policy.decision, reasons: policy.reasons, context: ctx, human_decision: null, tool_use_id: input.tool_use_id,
  };

  if (policy.decision === "deny") {
    append({ ...base, decided_by: "policy", decided_at: base.timestamp });
    out("deny", `NOT YET denied this by policy: ${policy.reasons.join(", ")}. It was not executed and cannot be approved from here.\n` + renderPause(action.raw, policy, ctx));
    return;
  }

  // approval_required
  if (watcherAlive()) {
    writePending({ id: base.event_id, created: base.timestamp, tool: input.tool_name, raw: action.raw, action, policy, context: ctx, cwd: input.cwd, session_id: input.session_id, tool_use_id: input.tool_use_id });
    const d = await waitForDecision(base.event_id, HOOK_BUDGET_MS);
    clearPending(base.event_id);
    if (d) {
      append({ ...base, human_decision: d.decision, decided_at: d.at, decided_by: "watch" });
      if (d.decision === "approved") out("allow", "approved by a human in NOT YET");
      else out("deny", JSON.stringify(rejection(action.raw, policy, "human (notyet watch)")));
      return;
    }
    append({ ...base, human_decision: "timed_out", decided_at: new Date().toISOString(), decided_by: "watch" });
    out("deny", JSON.stringify(rejection(action.raw, policy, "timeout — nobody answered in NOT YET")));
    return;
  }

  // no watcher: Claude Code's own prompt carries the block; the decision is made there
  append({ ...base, human_decision: "delegated_to_claude_code", decided_by: "watch" });
  out("ask", renderPause(action.raw, policy, ctx));
}

// PostToolUse: the tool ran. If we paused it, note that it executed.
export function runPost(input: HookInput): void {
  if (!input.tool_use_id) return;
  const paused = readAll().some((e) => e.tool_use_id === input.tool_use_id && (e.human_decision === "approved" || e.human_decision === "delegated_to_claude_code"));
  if (paused) append({ type: "executed", tool_use_id: input.tool_use_id, tool: input.tool_name, timestamp: new Date().toISOString() });
}
