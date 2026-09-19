// A live watcher must never read as dead, even while its heartbeat is being
// rewritten. Liveness is the file's mtime (atomic), so a concurrent reader
// sees either the old or the new file — never a torn one — and a hook that
// polls it can't be tricked into failing closed against a present human.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let HOME;
beforeEach(() => { HOME = fs.mkdtempSync(path.join(os.tmpdir(), "notyet-hb-")); process.env.NOTYET_HOME = HOME; });
const load = async () => import(`../dist/pending.js?${Math.random()}`);

test("no heartbeat file → not alive (fail closed)", async () => {
  const { watcherAlive } = await load();
  assert.equal(watcherAlive(), false);
});

test("fresh beat → alive; stale beat → dead", async () => {  // eslint-disable-line
  const { beat, watcherAlive } = await load();
  beat(); assert.equal(watcherAlive(), true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(watcherAlive(10), false);                // 30ms since the beat, 10ms tolerance → stale
});

test("liveness survives 2000 concurrent rewrites with no torn read", async () => {
  const { beat, watcherAlive } = await load();
  beat();
  let alive = true;
  const reader = (async () => { for (let i = 0; i < 2000; i++) { if (!watcherAlive()) alive = false; } })();
  const writer = (async () => { for (let i = 0; i < 2000; i++) beat(); })();
  await Promise.all([reader, writer]);
  assert.equal(alive, true, "a live watcher read as dead during a rewrite");
});

test("a watcher that stops beating is detected dead after the window", async () => {
  const { beat, watcherAlive } = await load();
  beat();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(watcherAlive(40), false);                // 60ms since last beat, 40ms tolerance → dead
});
