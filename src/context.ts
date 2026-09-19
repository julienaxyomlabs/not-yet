// Context enricher: the few facts a human wants at the moment of pause.
// Everything here is cheap, deterministic and read-only. When a fact cannot
// be supported, the value is the word "unknown" — never a guess.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PROTECTED_BRANCHES } from "./normalize.js";
import type { Context, Fact, NormalizedAction, Op } from "./types.js";

const UNKNOWN = "unknown";
const git = (cwd: string | undefined, args: string[]) => { if (!cwd) return null; try { return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).toString().trim(); } catch { return null; } };
const n = (x: number) => x.toLocaleString("en-US");

// count files under a path without following symlinks; stops at `cap`
function countFiles(p: string, cap = 5000): { files: number; capped: boolean } | null {
  let files = 0;
  try {
    const st = fs.lstatSync(p);
    if (!st.isDirectory()) return { files: 1, capped: false };
    const stack = [p];
    while (stack.length) {
      const d = stack.pop()!;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isSymbolicLink()) { files++; continue; }
        if (e.isDirectory()) stack.push(path.join(d, e.name)); else files++;
        if (files >= cap) return { files: cap, capped: true };
      }
    }
    return { files, capped: false };
  } catch { return null; }
}

// row estimate for local SQLite only, through a read-only connection
async function sqliteCount(db: string, table: string | null, where: string | null, cwd?: string): Promise<string> {
  if (!table) return UNKNOWN;
  const file = path.isAbsolute(db) ? db : path.resolve(cwd ?? process.cwd(), db);
  if (!fs.existsSync(file)) return UNKNOWN;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const conn = new DatabaseSync(file, { readOnly: true });
    try {
      const row = conn.prepare(`SELECT COUNT(*) AS c FROM "${table.replace(/"/g, '""')}"${where ? ` WHERE ${where}` : ""}`).get() as { c: number } | undefined;
      return row ? n(Number(row.c)) : UNKNOWN;
    } finally { conn.close(); }
  } catch { return UNKNOWN; }
}

function migrationFiles(changed: string[]): number { return changed.filter((f) => /(^|\/)(migrations?|migrate|db\/migrate|prisma\/migrations|supabase\/migrations)\//.test(f)).length; }

export async function enrich(action: NormalizedAction, cwd?: string): Promise<Context> {
  const facts: Fact[] = [];
  let reversible: string = UNKNOWN;
  let headline = action.raw;
  const ops = action.ops.filter((o) => o.type !== "read" && o.type !== "file_write" && o.type !== "exec");
  const main: Op | undefined = ops[0];

  if (action.parse === "failed") { facts.push({ label: "parsed", value: "no — shell syntax we do not evaluate" }); return { headline, facts, reversible }; }

  for (const op of ops) switch (op.type) {
    case "git_push": {
      const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const target = op.ref ?? UNKNOWN;
      facts.push({ label: "branch", value: `${branch ?? UNKNOWN} → ${op.remote ?? "origin"}/${target}` });
      const remoteRef = op.remote && op.ref ? `${op.remote}/${op.ref}` : null;
      const ahead = remoteRef ? git(cwd, ["rev-list", "--count", `${remoteRef}..HEAD`]) : null;
      const behind = remoteRef ? git(cwd, ["rev-list", "--count", `HEAD..${remoteRef}`]) : null;
      facts.push({ label: "commits ahead", value: ahead ?? UNKNOWN });
      if (op.force) facts.push({ label: "commits overwritten", value: behind ?? UNKNOWN });
      facts.push({ label: "force", value: op.force ? "yes" : "no" });
      if (op.ref && PROTECTED_BRANCHES.test(op.ref)) facts.push({ label: "protected", value: "yes" });
      reversible = op.force || op.deleteRef ? "no" : "yes";
      break;
    }
    case "git_merge": {
      facts.push({ label: "merge", value: `${op.branch ?? UNKNOWN} → ${op.into ?? UNKNOWN}` });
      const ahead = op.branch && op.into ? git(cwd, ["rev-list", "--count", `${op.into}..${op.branch}`]) : null;
      facts.push({ label: "commits", value: ahead ?? UNKNOWN });
      reversible = "yes";
      break;
    }
    case "git_rewrite": {
      facts.push({ label: "operation", value: op.what });
      const dirty = git(cwd, ["status", "--porcelain"]);
      facts.push({ label: "uncommitted changes", value: dirty === null ? UNKNOWN : n(dirty.split("\n").filter(Boolean).length) });
      reversible = "no";
      break;
    }
    case "rm": {
      let total = 0, capped = false, known = true;
      for (const p of op.paths) {
        if (/[*?]/.test(p)) { known = false; continue; }
        const abs = p.startsWith("~") ? p.replace(/^~/, os.homedir()) : path.resolve(cwd ?? process.cwd(), p);
        const c = countFiles(abs); if (!c) { known = false; continue; }
        total += c.files; capped ||= c.capped;
      }
      facts.push({ label: "path", value: op.paths.join("  ") || UNKNOWN });
      facts.push({ label: "files", value: known ? (capped ? `${n(total)}+` : n(total)) : UNKNOWN });
      const tracked = cwd && op.paths.length && !/[*?]/.test(op.paths[0]) ? git(cwd, ["ls-files", "--error-unmatch", op.paths[0]]) : null;
      reversible = tracked ? "yes (tracked in git)" : "no";
      break;
    }
    case "sql": {
      headline = op.statement;
      facts.push({ label: "operation", value: op.op });
      facts.push({ label: "table", value: op.table ?? UNKNOWN });
      facts.push({ label: "environment", value: op.environment ?? UNKNOWN });
      facts.push({ label: "estimated rows", value: op.op === "DELETE" || op.op === "UPDATE" ? (op.db ? await sqliteCount(op.db, op.table, op.where, cwd) : UNKNOWN) : op.op === "DROP" || op.op === "TRUNCATE" ? (op.db ? await sqliteCount(op.db, op.table, null, cwd) : UNKNOWN) : UNKNOWN });
      reversible = "no";
      break;
    }
    case "migration": {
      facts.push({ label: "migration", value: op.direction });
      facts.push({ label: "tool", value: op.tool });
      reversible = op.direction === "up" ? UNKNOWN : "no";
      break;
    }
    case "deploy": {
      facts.push({ label: "environment", value: op.environment ?? UNKNOWN });
      const input = action.input;
      const changed = Array.isArray(input.changed_files) ? (input.changed_files as string[]) : null;
      if (changed) { facts.push({ label: "files changed", value: n(changed.length) }); facts.push({ label: "migrations detected", value: n(typeof input.migrations === "number" ? input.migrations : migrationFiles(changed)) }); }
      else {
        const upstream = git(cwd, ["rev-parse", "--abbrev-ref", "@{u}"]);
        const diff = upstream ? git(cwd, ["diff", "--name-only", `${upstream}...HEAD`]) : null;
        const dirty = git(cwd, ["status", "--porcelain"]);
        const files = diff !== null ? diff.split("\n").filter(Boolean) : null;
        facts.push({ label: "files changed", value: files ? `${n(files.length)} since ${upstream}${dirty ? ` (+${n(dirty.split("\n").filter(Boolean).length)} uncommitted)` : ""}` : UNKNOWN });
        facts.push({ label: "migrations detected", value: files ? n(migrationFiles(files)) : UNKNOWN });
      }
      facts.push({ label: "via", value: op.via });
      reversible = typeof input.rollback_available === "boolean" ? (input.rollback_available ? "yes" : "no") : UNKNOWN;
      break;
    }
    case "publish": facts.push({ label: "publishes", value: op.what }); reversible = "no"; break;
    case "send": {
      facts.push({ label: "recipients", value: op.recipients === null ? UNKNOWN : n(op.recipients) });
      facts.push({ label: "via", value: op.via });
      if (typeof action.input.subject === "string") facts.push({ label: "subject", value: String(action.input.subject).slice(0, 80) });
      reversible = "no";
      break;
    }
    case "payment": {
      facts.push({ label: "operation", value: op.kind });
      const amt = action.input.amount ?? action.input.amount_cents; const cur = action.input.currency;
      facts.push({ label: "amount", value: amt !== undefined ? `${amt}${cur ? " " + cur : ""}` : UNKNOWN });
      facts.push({ label: "via", value: op.via });
      reversible = op.kind === "charge" ? "partly (refund)" : "no";
      break;
    }
    case "credential": facts.push({ label: "credential", value: op.action }); facts.push({ label: "detail", value: op.detail }); reversible = op.action === "mutate" ? UNKNOWN : "no"; break;
    case "permission": facts.push({ label: "permission", value: op.detail }); reversible = UNKNOWN; break;
    case "catastrophic": facts.push({ label: "would remove", value: op.detail }); reversible = "no"; break;
  }
  if (action.production_hint && !facts.some((f) => f.label === "environment")) facts.push({ label: "environment", value: "production (named in the command)" });
  if (!main) facts.push({ label: "context", value: UNKNOWN });
  return { headline, facts, reversible };
}
