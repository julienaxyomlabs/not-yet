// The gate executes exactly once, only after approval, and logs what it did.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gate } from "../dist/gate.js";
import { readAll } from "../dist/log.js";

beforeEach(() => { process.env.NOTYET_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "notyet-test-")); });
const neverAsk = async () => { throw new Error("ask must not be called"); };

test("safe action executes without asking, no event", async () => {
  let runs = 0;
  const r = await gate({ tool: "Bash", input: { command: "ls" } }, async () => ++runs, { ask: neverAsk });
  assert.equal(r.decision, "allow"); assert.equal(runs, 1); assert.equal(r.executed, true); assert.equal(readAll().length, 0);
});

test("paused action does not execute before the human answers; reject prevents execution", async () => {
  let runs = 0; let askedWith = null;
  const r = await gate({ tool: "Bash", input: { command: "git push --force origin main" } }, async () => ++runs, { ask: async (raw, action, policy, ctx) => { askedWith = { raw, policy, ctx }; assert.equal(runs, 0, "executed before decision"); return "rejected"; } });
  assert.equal(r.decision, "approval_required"); assert.equal(r.human, "rejected"); assert.equal(runs, 0); assert.equal(r.executed, false);
  assert.equal(r.rejection.status, "rejected"); assert.deepEqual(r.rejection.reasons, ["force_push", "protected_branch"]);
  assert.deepEqual(askedWith.policy.reasons, ["force_push", "protected_branch"]);
  const ev = readAll(); assert.equal(ev.length, 1); assert.equal(ev[0].human_decision, "rejected"); assert.equal(ev[0].policy_decision, "approval_required"); assert.equal(ev[0].raw_action, "git push --force origin main");
});

test("approve executes exactly once and the log matches", async () => {
  let runs = 0;
  const r = await gate({ tool: "mcp__demo__send_email", input: { recipient_count: 1842 } }, async () => ++runs, { ask: async () => "approved" });
  assert.equal(runs, 1); assert.equal(r.executed, true); assert.equal(r.human, "approved");
  const ev = readAll(); assert.equal(ev.length, 2); assert.equal(ev[0].human_decision, "approved"); assert.equal(ev[1].type, "executed"); assert.equal(ev[1].event_id, ev[0].event_id);
  assert.equal(ev[0].context.facts.find((f) => f.label === "recipients").value, "1,842");
});

test("deny never executes and never asks", async () => {
  let runs = 0;
  const r = await gate({ tool: "Bash", input: { command: "rm -rf /" } }, async () => ++runs, { ask: neverAsk });
  assert.equal(r.decision, "deny"); assert.equal(runs, 0); assert.equal(readAll()[0].decided_by, "policy");
});

test("unparseable risky command fails closed", async () => {
  let runs = 0; let asked = false;
  const r = await gate({ tool: "Bash", input: { command: "rm -rf $(cat dirs)" } }, async () => ++runs, { ask: async () => { asked = true; return "rejected"; } });
  assert.equal(r.decision, "approval_required"); assert.ok(asked); assert.equal(runs, 0); assert.ok(r.reasons.includes("unparseable_risky_command"));
});

test("context: unknown is said, not invented", async () => {
  const r = await gate({ tool: "mcp__demo__deploy_production", input: {} }, async () => 1, { ask: async () => "rejected" });
  const facts = Object.fromEntries(r.context.facts.map((f) => [f.label, f.value]));
  assert.equal(facts["files changed"], "unknown"); assert.equal(facts["migrations detected"], "unknown"); assert.equal(r.context.reversible, "unknown");
});

test("context: sqlite row estimate is real and read-only", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = path.join(process.env.NOTYET_HOME, "t.db"); const c = new DatabaseSync(db); c.exec("create table customers(id integer, inactive integer)"); for (let i = 0; i < 50; i++) c.prepare("insert into customers values (?, ?)").run(i, i < 17 ? 1 : 0); c.close();
  const r = await gate({ tool: "mcp__demo__run_sql", input: { db, sql: "DELETE FROM customers WHERE inactive = 1" } }, async () => 1, { ask: async () => "rejected" });
  assert.equal(r.context.facts.find((f) => f.label === "estimated rows").value, "17");
  const c2 = new DatabaseSync(db, { readOnly: true }); assert.equal(c2.prepare("select count(*) c from customers").get().c, 50); c2.close();   // nothing deleted
});

test("context: rm counts files cheaply", async () => {
  const d = path.join(process.env.NOTYET_HOME, "junk"); fs.mkdirSync(path.join(d, "sub"), { recursive: true }); for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(d, i < 6 ? "" : "sub", `f${i}`), "x");
  const r = await gate({ tool: "Bash", input: { command: "rm -rf junk" }, cwd: process.env.NOTYET_HOME }, async () => 1, { ask: async () => "rejected" });
  assert.equal(r.context.facts.find((f) => f.label === "files").value, "12"); assert.ok(fs.existsSync(d));
});
