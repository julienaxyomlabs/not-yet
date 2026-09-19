// The shapes that travel through the pipeline:
// tool call → NormalizedAction → PolicyResult → Context → Event.

export type ToolCall = {
  tool: string;                       // "Bash", "Write", "mcp__notyet-demo__deploy_production", …
  input: Record<string, unknown>;     // the tool's own input, untouched
  cwd?: string;
  session_id?: string;
  tool_use_id?: string;
};

// One thing the action does. A shell line can do several (a && b && c).
export type Op =
  | { type: "read"; program: string }
  | { type: "exec"; program: string; args: string[] }
  | { type: "git_push"; remote: string | null; ref: string | null; force: boolean; deleteRef: boolean; tags: boolean }
  | { type: "git_merge"; branch: string | null; into: string | null }
  | { type: "git_rewrite"; what: string }               // reset --hard, checkout -- ., clean -f, branch -D, filter-branch
  | { type: "rm"; paths: string[]; recursive: boolean; force: boolean }
  | { type: "sql"; op: "DELETE" | "DROP" | "TRUNCATE" | "UPDATE" | "ALTER"; table: string | null; where: string | null; statement: string; db: string | null; environment: string | null }
  | { type: "migration"; direction: "up" | "down" | "reset" | "unknown"; tool: string }
  | { type: "deploy"; environment: string | null; via: string }
  | { type: "publish"; what: string }
  | { type: "send"; kind: "email" | "message"; recipients: number | null; via: string }
  | { type: "payment"; kind: "charge" | "refund" | "transfer" | "payout"; via: string }
  | { type: "credential"; action: "mutate" | "expose" | "exfiltrate"; detail: string }
  | { type: "permission"; detail: string }
  | { type: "file_write"; path: string; tool: string }
  | { type: "catastrophic"; detail: string };

export type NormalizedAction = {
  tool: string;
  raw: string;                 // what a human would read: the command, the file path, the tool call
  ops: Op[];
  parse: "ok" | "failed";      // failed = we could not tokenise the shell line
  production_hint: boolean;    // the text explicitly targets production
  input: Record<string, unknown>;
};

export type Decision = "allow" | "approval_required" | "deny";

export type PolicyResult = { decision: Decision; reasons: string[] };

// Facts a human wants at the moment of pause. Every value is either
// derived from something we can actually inspect, or "unknown".
export type Fact = { label: string; value: string };
export type Context = { headline: string; facts: Fact[]; reversible: string };  // "yes" | "no" | "unknown" | a qualified answer

export type HumanDecision = "approved" | "rejected" | "delegated_to_claude_code" | "timed_out";

export type Event = {
  run_id: string;
  event_id: string;
  timestamp: string;
  tool: string;
  raw_action: string;
  normalized_action: NormalizedAction;
  policy_decision: Decision;
  reasons: string[];
  context: Context | null;
  human_decision: HumanDecision | null;
  tool_use_id?: string;
  decided_at?: string;
  decided_by?: "watch" | "demo" | "policy";
};
