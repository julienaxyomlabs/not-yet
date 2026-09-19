// The in-process gate: intercept → normalize → policy → context → human →
// execute exactly once → log. Used by the demo and the tests; the Claude Code
// hook is the same pipeline split across two processes.
import { normalize } from "./normalize.js";
import { evaluate } from "./policy.js";
import { enrich } from "./context.js";
import { rejection } from "./render.js";
import { append, newId } from "./log.js";
import { askOnTerminal, type Choice } from "./approve.js";
import type { Context, Event, NormalizedAction, PolicyResult, ToolCall } from "./types.js";

export type Ask = (raw: string, action: NormalizedAction, policy: PolicyResult, ctx: Context) => Promise<Choice>;
export type GateResult = { decision: "allow" | "approval_required" | "deny"; human: Choice | null; executed: boolean; result?: unknown; rejection?: ReturnType<typeof rejection>; reasons: string[]; context: Context | null; event_id: string | null };

export async function gate<T>(call: ToolCall, execute: () => Promise<T>, opts: { ask?: Ask; run_id?: string } = {}): Promise<GateResult> {
  const action = normalize(call);
  const policy = evaluate(action);
  let executions = 0;
  const once = async () => { if (executions++) throw new Error("gate: execute called twice"); return execute(); };

  if (policy.decision === "allow") return { decision: "allow", human: null, executed: true, result: await once(), reasons: [], context: null, event_id: null };

  const ctx = await enrich(action, call.cwd);
  const base: Event = { run_id: opts.run_id ?? newId("run"), event_id: newId("evt"), timestamp: new Date().toISOString(), tool: call.tool, raw_action: action.raw, normalized_action: action, policy_decision: policy.decision, reasons: policy.reasons, context: ctx, human_decision: null, tool_use_id: call.tool_use_id };

  if (policy.decision === "deny") {
    append({ ...base, decided_by: "policy", decided_at: base.timestamp });
    return { decision: "deny", human: null, executed: false, rejection: rejection(action.raw, policy, "policy"), reasons: policy.reasons, context: ctx, event_id: base.event_id };
  }

  const choice = await (opts.ask ?? ((r, a, p, c) => askOnTerminal(r, a, p, c)))(action.raw, action, policy, ctx);
  append({ ...base, human_decision: choice, decided_at: new Date().toISOString(), decided_by: "demo" });
  if (choice === "approved") {
    const result = await once();
    append({ type: "executed", event_id: base.event_id, tool_use_id: call.tool_use_id, tool: call.tool, timestamp: new Date().toISOString() });
    return { decision: "approval_required", human: "approved", executed: true, result, reasons: policy.reasons, context: ctx, event_id: base.event_id };
  }
  return { decision: "approval_required", human: "rejected", executed: false, rejection: rejection(action.raw, policy, "human"), reasons: policy.reasons, context: ctx, event_id: base.event_id };
}
