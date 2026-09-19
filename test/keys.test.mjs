// The watcher's input path, with a fake terminal: one key decides, stray
// keys at idle are dropped, escape sequences are never a decision, the
// terminal stays raw between pauses and is restored on close.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { askOnTerminal, openKeys, closeKeys } from "../dist/approve.js";
import { normalize } from "../dist/normalize.js";
import { evaluate } from "../dist/policy.js";

function fakeTerminal() {
  const inp = new EventEmitter(); inp.isTTY = true; inp.raw = []; inp.resumed = 0; inp.paused = 0;
  inp.setRawMode = (b) => inp.raw.push(b); inp.resume = () => inp.resumed++; inp.pause = () => inp.paused++; inp.setEncoding = () => {};
  const out = { isTTY: false, columns: 80, text: "", write(s) { this.text += s; return true; } };
  const press = (k) => inp.emit("data", k);
  return { inp, out, press };
}
const action = normalize({ tool: "Bash", input: { command: "git push --force origin main" } });
const policy = evaluate(action);
const ctx = { headline: action.raw, facts: [{ label: "force", value: "yes" }], reversible: "no" };
const tick = () => new Promise((r) => setImmediate(r));

test("one key decides; raw mode is set once and kept", async () => {
  closeKeys(); const t = fakeTerminal();
  const p = askOnTerminal(action.raw, action, policy, ctx, { inp: t.inp, out: t.out });
  await tick(); assert.deepEqual(t.inp.raw, [true]); assert.equal(t.inp.resumed, 1);
  t.press("r");
  assert.equal(await p, "rejected");
  assert.match(t.out.text, /a \/ r · i to inspect reject\n\n$/);
  assert.deepEqual(t.inp.raw, [true], "raw mode must not be turned off between pauses");
  closeKeys(); assert.deepEqual(t.inp.raw, [true, false]); assert.equal(t.inp.paused, 1);
});

test("keys pressed while nothing is pending are dropped, not applied to the next pause", async () => {
  closeKeys(); const t = fakeTerminal();
  openKeys(t.inp, () => {});
  t.press("a"); t.press("a"); t.press("r");                       // stray keys at idle
  let resolved = null;
  const p = askOnTerminal(action.raw, action, policy, ctx, { inp: t.inp, out: t.out }).then((c) => (resolved = c));
  await tick(); await tick(); assert.equal(resolved, null, "an idle keypress must not decide the next pause");
  t.press("r"); await p; assert.equal(resolved, "rejected");
  closeKeys();
});

test("escape sequences and multi-byte chunks are ignored; i inspects and keeps waiting; then a approves", async () => {
  closeKeys(); const t = fakeTerminal();
  let resolved = null;
  const p = askOnTerminal(action.raw, action, policy, ctx, { inp: t.inp, out: t.out }).then((c) => (resolved = c));
  await tick();
  t.press("\x1b[I"); t.press("\x1b"); t.press("ra"); t.press("\r"); t.press("\n");
  await tick(); assert.equal(resolved, null);
  t.press("i"); await tick(); assert.match(t.out.text, /"reasons": \[\s*"force_push",\s*"protected_branch"\s*\]/); assert.equal(resolved, null);
  t.press("a"); await p; assert.equal(resolved, "approved"); assert.match(t.out.text, /approve\n\n$/);
  closeKeys();
});

test("ctrl-c restores the terminal and calls the interrupt handler", async () => {
  closeKeys(); const t = fakeTerminal(); let interrupted = false;
  openKeys(t.inp, () => (interrupted = true));
  t.press("\x03");
  assert.ok(interrupted); assert.deepEqual(t.inp.raw, [true, false]);
});

test("no terminal: refuses rather than pretending", async () => {
  closeKeys(); const t = fakeTerminal(); t.inp.isTTY = false;
  await assert.rejects(askOnTerminal(action.raw, action, policy, ctx, { inp: t.inp, out: t.out }), /no terminal/);
});
