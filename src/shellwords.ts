// A small, honest shell tokenizer. It understands quotes, escapes, and the
// operators that chain commands. Anything it does not understand makes it
// return { ok: false } — the policy engine treats that as a reason to stop,
// not a reason to guess.

export type Segment = { words: string[] };
export type Tokenized = { ok: true; segments: Segment[] } | { ok: false; error: string };

const CHAIN = new Set(["&&", "||", ";", "|", "&"]);

export function tokenize(line: string): Tokenized {
  const segments: Segment[] = [];
  let words: string[] = [];
  let cur = "";
  let has = false;             // current word has content (so "" quoted args survive)
  let i = 0;
  const push = () => { if (has) { words.push(cur); } cur = ""; has = false; };
  const endSegment = () => { push(); if (words.length) segments.push({ words }); words = []; };
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === "'") {
      const j = line.indexOf("'", i + 1);
      if (j < 0) return { ok: false, error: "unterminated single quote" };
      cur += line.slice(i + 1, j); has = true; i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1; let s = "";
      while (j < n && line[j] !== '"') {
        if (line[j] === "\\" && j + 1 < n && '"\\$`'.includes(line[j + 1])) { s += line[j + 1]; j += 2; continue; }
        s += line[j]; j++;
      }
      if (j >= n) return { ok: false, error: "unterminated double quote" };
      cur += s; has = true; i = j + 1; continue;
    }
    if (c === "\\") { if (i + 1 >= n) return { ok: false, error: "trailing backslash" }; cur += line[i + 1]; has = true; i += 2; continue; }
    if (c === "$" && line[i + 1] === "(") return { ok: false, error: "command substitution" };
    if (c === "`") return { ok: false, error: "backtick substitution" };
    if (c === "\n" || c === ";") { endSegment(); i++; continue; }
    if (c === "&" && line[i + 1] === "&") { endSegment(); i += 2; continue; }
    if (c === "|" && line[i + 1] === "|") { endSegment(); i += 2; continue; }
    if (c === "|") { endSegment(); i++; continue; }
    if (c === "&") { endSegment(); i++; continue; }
    if (c === ">" || c === "<") {                         // redirections: drop the operator and its target
      push(); i++; if (line[i] === ">" || line[i] === "&") i++;
      while (i < n && line[i] === " ") i++;
      while (i < n && !" \t\n;|&".includes(line[i])) i++;
      continue;
    }
    if (c === " " || c === "\t") { push(); i++; continue; }
    cur += c; has = true; i++;
  }
  endSegment();
  return { ok: true, segments };
}

export const isChain = (w: string) => CHAIN.has(w);
