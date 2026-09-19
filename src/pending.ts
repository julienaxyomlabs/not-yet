// The hand-off between a hook (no terminal) and the watcher (a terminal).
// A pending request is a file; a decision is another file next to it.
// Polling with files is not elegant, but it needs no daemon and cannot lose
// a decision to a dropped socket.
import fs from "node:fs";
import path from "node:path";
import { home } from "./log.js";
import type { Context, NormalizedAction, PolicyResult } from "./types.js";

export type Pending = { id: string; created: string; tool: string; raw: string; action: NormalizedAction; policy: PolicyResult; context: Context; cwd?: string; session_id?: string; tool_use_id?: string };
export type DecisionFile = { decision: "approved" | "rejected"; at: string; by: string };

export const pendingDir = () => path.join(home(), "pending");
const heartbeat = () => path.join(home(), "watcher.json");

export function writePending(p: Pending) { fs.mkdirSync(pendingDir(), { recursive: true }); const f = path.join(pendingDir(), `${p.id}.json`); fs.writeFileSync(f + ".tmp", JSON.stringify(p)); fs.renameSync(f + ".tmp", f); return f; }
export function readDecision(id: string): DecisionFile | null { try { return JSON.parse(fs.readFileSync(path.join(pendingDir(), `${id}.decision.json`), "utf8")); } catch { return null; } }
export function writeDecision(id: string, d: DecisionFile) { const f = path.join(pendingDir(), `${id}.decision.json`); fs.writeFileSync(f + ".tmp", JSON.stringify(d)); fs.renameSync(f + ".tmp", f); }
export function listPending(): Pending[] {
  try { return fs.readdirSync(pendingDir()).filter((f) => f.endsWith(".json") && !f.endsWith(".decision.json")).map((f) => JSON.parse(fs.readFileSync(path.join(pendingDir(), f), "utf8")) as Pending).filter((p) => !readDecision(p.id)).sort((a, b) => a.created.localeCompare(b.created)); } catch { return []; }
}
export function clearPending(id: string) { for (const f of [`${id}.json`, `${id}.decision.json`]) { try { fs.unlinkSync(path.join(pendingDir(), f)); } catch {} } }

export function beat() { fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(heartbeat(), JSON.stringify({ pid: process.pid, at: Date.now() })); }
export function watcherAlive(maxAgeMs = 6000): boolean { try { const h = JSON.parse(fs.readFileSync(heartbeat(), "utf8")); return Date.now() - h.at < maxAgeMs; } catch { return false; } }

export async function waitForDecision(id: string, timeoutMs: number): Promise<DecisionFile | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = readDecision(id); if (d) return d;
    if (!watcherAlive()) return null;          // the watcher went away: fall back rather than hang
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}
