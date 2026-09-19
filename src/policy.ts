// The rule engine. Plain code, ordered, inspectable. Every rule maps an Op
// (plus a little about the whole action) to zero or more reasons; a reason
// belongs to one of two tiers. No model, no scoring, no hidden state.
import { PROTECTED_BRANCHES, riskyLooking } from "./normalize.js";
import type { NormalizedAction, Op, PolicyResult } from "./types.js";

export const MASS_SEND_THRESHOLD = 10;   // recipients at or above this pause
export const MASS_DELETE_THRESHOLD = 10; // paths named on one rm

// tier: "deny" — never run this from an agent; "pause" — a human decides
export const REASONS: Record<string, { tier: "deny" | "pause"; text: string }> = {
  force_push:                 { tier: "pause", text: "rewrites history on the remote" },
  protected_branch:           { tier: "pause", text: "targets a protected branch" },
  branch_delete:              { tier: "pause", text: "deletes a remote branch" },
  publish_tags:               { tier: "pause", text: "publishes tags" },
  unknown_target_branch:      { tier: "pause", text: "could not determine the target branch" },
  merge_into_protected_branch:{ tier: "pause", text: "merges into a protected branch" },
  history_rewrite:            { tier: "pause", text: "discards local history or changes" },
  recursive_delete:           { tier: "pause", text: "deletes recursively" },
  mass_delete:                { tier: "pause", text: "deletes many paths" },
  sql_delete:                 { tier: "pause", text: "deletes rows" },
  sql_drop:                   { tier: "pause", text: "drops a table or database" },
  sql_truncate:               { tier: "pause", text: "empties a table" },
  sql_alter_drop:             { tier: "pause", text: "drops a column or constraint" },
  sql_update_without_where:   { tier: "pause", text: "updates every row" },
  database_migration:         { tier: "pause", text: "changes a database schema" },
  destructive_migration:      { tier: "pause", text: "rolls back or resets a database" },
  production_deploy:          { tier: "pause", text: "deploys to production" },
  deploy_unknown_environment: { tier: "pause", text: "deploys somewhere we could not identify" },
  infrastructure_change:      { tier: "pause", text: "changes running infrastructure" },
  public_publish:             { tier: "pause", text: "publishes publicly" },
  mass_send:                  { tier: "pause", text: "sends to many people" },
  send_unknown_recipients:    { tier: "pause", text: "sends to an unknown number of people" },
  payment:                    { tier: "pause", text: "moves money" },
  credential_mutation:        { tier: "pause", text: "changes credentials" },
  credential_exposure:        { tier: "pause", text: "reveals a secret" },
  credential_exfiltration:    { tier: "deny",  text: "sends a secret off the machine" },
  permission_change:          { tier: "pause", text: "changes permissions" },
  privilege_escalation:       { tier: "pause", text: "runs with elevated privileges" },
  production_target:          { tier: "pause", text: "explicitly targets production" },
  catastrophic_path:          { tier: "deny",  text: "would destroy the machine or home directory" },
  unparseable_risky_command:  { tier: "pause", text: "could not be parsed and looks risky" },
};

function reasonsFor(op: Op, action: NormalizedAction): string[] {
  const r: string[] = [];
  switch (op.type) {
    case "read": case "exec": case "file_write": break;
    case "git_push":
      if (op.force) r.push("force_push");
      if (op.ref && PROTECTED_BRANCHES.test(op.ref)) r.push("protected_branch");
      if (!op.ref) r.push("unknown_target_branch");
      if (op.deleteRef) r.push("branch_delete");
      if (op.tags) r.push("publish_tags");
      break;
    case "git_merge":
      if (op.into && PROTECTED_BRANCHES.test(op.into)) r.push("merge_into_protected_branch");
      else if (!op.into) r.push("unknown_target_branch");
      break;
    case "git_rewrite": r.push("history_rewrite"); break;
    case "rm":
      if (op.recursive) r.push("recursive_delete");
      if (op.paths.length >= MASS_DELETE_THRESHOLD || op.paths.some((p) => /[*?]/.test(p))) r.push("mass_delete");
      break;
    case "sql":
      if (op.op === "DELETE") r.push("sql_delete");
      if (op.op === "DROP") r.push("sql_drop");
      if (op.op === "TRUNCATE") r.push("sql_truncate");
      if (op.op === "ALTER") r.push("sql_alter_drop");
      if (op.op === "UPDATE" && !op.where) r.push("sql_update_without_where");
      if (op.environment && /prod/i.test(op.environment)) r.push("production_target");
      break;
    case "migration": r.push(op.direction === "up" || op.direction === "unknown" ? "database_migration" : "destructive_migration"); break;
    case "deploy":
      if (op.via.includes("destroy") || /^(kubectl|terraform|tofu)/.test(op.via)) r.push("infrastructure_change");
      if (op.environment === null) r.push("deploy_unknown_environment");
      else if (/prod|live/i.test(op.environment)) r.push("production_deploy");
      break;
    case "publish": r.push("public_publish"); break;
    case "send":
      if (op.recipients === null) r.push("send_unknown_recipients");
      else if (op.recipients >= MASS_SEND_THRESHOLD) r.push("mass_send");
      break;
    case "payment": r.push("payment"); break;
    case "credential": r.push(op.action === "mutate" ? "credential_mutation" : op.action === "expose" ? "credential_exposure" : "credential_exfiltration"); break;
    case "permission": r.push(op.detail === "sudo" ? "privilege_escalation" : "permission_change"); break;
    case "catastrophic": r.push("catastrophic_path"); break;
  }
  return r;
}

export function evaluate(action: NormalizedAction): PolicyResult {
  const reasons = new Set<string>();
  if (action.parse === "failed") {
    if (riskyLooking(action.raw)) reasons.add("unparseable_risky_command");
    return finish(reasons);
  }
  for (const op of action.ops) for (const x of reasonsFor(op, action)) reasons.add(x);
  // an explicit production target makes any non-read action consequential
  if (action.production_hint && !reasons.has("production_deploy") && !reasons.has("production_target") && action.ops.some((o) => o.type !== "read" && o.type !== "file_write")) reasons.add("production_target");
  return finish(reasons);
}

function finish(set: Set<string>): PolicyResult {
  const reasons = [...set];
  if (reasons.some((x) => REASONS[x]?.tier === "deny")) return { decision: "deny", reasons };
  if (reasons.length) return { decision: "approval_required", reasons };
  return { decision: "allow", reasons: [] };
}

export const explain = (reason: string) => REASONS[reason]?.text ?? reason;
