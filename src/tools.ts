// Demo tools with fake consequences. deploy_production pretends; send_email
// writes to an outbox file; run_sql runs for real, but only against SQLite
// files inside NOTYET_HOME or the OS temp dir, so nothing real can be hit.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { home } from "./log.js";

export type ToolResult = { ok: boolean; text: string };

export const DEMO_TOOLS = {
  deploy_production: {
    description: "Deploy the current build to production. (demo: simulated — nothing is deployed)",
    inputSchema: { type: "object", properties: { changed_files: { type: "array", items: { type: "string" } }, migrations: { type: "number" }, rollback_available: { type: "boolean" }, environment: { type: "string" } } },
    run: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const files = Array.isArray(args.changed_files) ? args.changed_files.length : 0;
      return { ok: true, text: `deployed to production (simulated). ${files} files, ${Number(args.migrations ?? 0)} migrations applied. build ${Date.now().toString(36)}` };
    },
  },
  send_email: {
    description: "Send an email to a list of recipients. (demo: writes to a local outbox, sends nothing)",
    inputSchema: { type: "object", properties: { recipients: { type: "array", items: { type: "string" } }, recipient_count: { type: "number" }, subject: { type: "string" }, body: { type: "string" } } },
    run: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const count = Array.isArray(args.recipients) ? args.recipients.length : Number(args.recipient_count ?? 0);
      fs.mkdirSync(home(), { recursive: true });
      fs.appendFileSync(path.join(home(), "outbox.jsonl"), JSON.stringify({ at: new Date().toISOString(), count, subject: args.subject ?? null }) + "\n");
      return { ok: true, text: `queued ${count} emails in the demo outbox (nothing was sent).` };
    },
  },
  run_sql: {
    description: "Run a SQL statement against a local SQLite database file. (demo: only files under the NOT YET home or the temp dir)",
    inputSchema: { type: "object", properties: { db: { type: "string" }, sql: { type: "string" }, environment: { type: "string" } }, required: ["db", "sql"] },
    run: async (args: Record<string, unknown>): Promise<ToolResult> => {
      const db = String(args.db ?? ""); const sql = String(args.sql ?? "");
      const abs = path.resolve(db);
      const allowed = [home(), os.tmpdir(), fs.realpathSync(os.tmpdir())].some((d) => abs.startsWith(d + path.sep));
      if (!allowed) return { ok: false, text: `refused: ${abs} is outside the demo sandbox` };
      const { DatabaseSync } = await import("node:sqlite");
      const conn = new DatabaseSync(abs);
      try {
        if (/^\s*select/i.test(sql)) { const rows = conn.prepare(sql).all(); return { ok: true, text: JSON.stringify(rows.slice(0, 20)) }; }
        const r = conn.prepare(sql).run();
        return { ok: true, text: `ok. ${Number(r.changes)} rows changed.` };
      } finally { conn.close(); }
    },
  },
};
export type DemoToolName = keyof typeof DEMO_TOOLS;
