// Append-only JSONL. One line per decision. The boring option.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import type { Event } from "./types.js";

export const home = () => process.env.NOTYET_HOME || path.join(os.homedir(), ".notyet");
export const logPath = () => path.join(home(), "events.jsonl");
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

export function append(ev: Event | Record<string, unknown>) {
  fs.mkdirSync(home(), { recursive: true });
  fs.appendFileSync(logPath(), JSON.stringify(ev) + "\n", { mode: 0o600 });
}

export function readAll(): Record<string, unknown>[] {
  try { return fs.readFileSync(logPath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
