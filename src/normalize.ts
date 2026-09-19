// Tool call → NormalizedAction. Deterministic, no network, no execution.
// The only thing this file may run is `git` in read-only form, to learn the
// current branch and upstream when a push or merge doesn't name its target.
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { tokenize } from "./shellwords.js";
import type { NormalizedAction, Op, ToolCall } from "./types.js";

export const PROTECTED_BRANCHES = /^(main|master|production|prod|release|live)$/i;

const READ_PROGRAMS = new Set(["ls", "pwd", "cat", "grep", "egrep", "fgrep", "rg", "ag", "find", "fd", "head", "tail", "less", "more", "wc", "echo", "printf", "which", "whoami", "date", "env", "printenv", "stat", "file", "du", "df", "tree", "diff", "sort", "uniq", "cut", "awk", "sed", "jq", "yq", "basename", "dirname", "realpath", "readlink", "type", "true", "false", "test", "[", "sleep", "open", "code", "man", "history", "id", "uname", "hostname", "cd", "export", "source", "mkdir", "touch", "cp", "mv", "ln", "tar", "zip", "unzip", "gzip", "curl", "wget", "ping", "dig", "nslookup", "xargs", "tee", "brew", "pip", "pip3", "pnpm", "yarn", "supabase", "vercel", "gh", "docker", "kubectl", "terraform", "aws", "gcloud", "fly", "flyctl", "netlify", "firebase", "heroku", "wrangler", "stripe", "twine", "gem", "psql", "mysql", "sqlite3", "prisma", "knex", "alembic", "rails", "bundle", "sqlite", "git", "npm", "chmod", "chown", "sudo", "rm", "sendmail", "mail", "mutt"]);
// programs in READ_PROGRAMS are the ones we *know*; the specific handlers below
// decide which of their invocations are consequential. Unknown programs are
// plain `exec` ops — allowed unless something else in the line says otherwise.

const SECRET_PATH = /(^|\/)(\.env(\..+)?|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|service[-_]account.*\.json|.*\.pem|.*\.key|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|\.aws\/.*|\.ssh\/.*|\.docker\/config\.json|\.git-credentials|.*secret.*)$/i;
const NETWORK = new Set(["curl", "wget", "nc", "ncat", "http", "https", "openssl", "ssh", "scp", "rsync", "sftp"]);
const RISKY = /\b(rm|push|merge|drop|delete|truncate|deploy|publish|sudo|chmod|chown|reset|migrate|prod|production|force|-rf|-fr|--force)\b|>\s*\S*\.env/i;
const PROD_WORD = /(^|[^a-z])(prod|production)([^a-z]|$)/i;

const base = (w: string) => path.basename(w);
const isFlag = (w: string) => w.startsWith("-");

function gitInfo(cwd?: string): { branch: string | null; upstream: string | null } {
  if (!cwd) return { branch: null, upstream: null };
  const run = (args: string[]) => { try { return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 1500 }).toString().trim(); } catch { return null; } };
  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  const upstream = run(["rev-parse", "--abbrev-ref", "@{u}"]);
  return { branch: branch && branch !== "HEAD" ? branch : null, upstream };
}

// ── SQL ──────────────────────────────────────────────────────────────────
export function sqlOps(statement: string, db: string | null, environment: string | null): Op[] {
  const ops: Op[] = [];
  for (const raw of statement.split(";")) {
    const s = raw.trim(); if (!s) continue;
    const first = s.split(/\s+/)[0].toUpperCase();
    const ident = (m: RegExpMatchArray | null) => m ? m[1].replace(/["`\[\]]/g, "") : null;
    if (first === "DELETE") { const t = ident(s.match(/^DELETE\s+FROM\s+([\w."`\[\]]+)/i)); const w = s.match(/\bWHERE\b([\s\S]+)$/i)?.[1]?.trim() ?? null; ops.push({ type: "sql", op: "DELETE", table: t, where: w, statement: s, db, environment }); }
    else if (first === "DROP") { const t = ident(s.match(/^DROP\s+(?:TABLE|DATABASE|SCHEMA|INDEX|VIEW)\s+(?:IF\s+EXISTS\s+)?([\w."`\[\]]+)/i)); ops.push({ type: "sql", op: "DROP", table: t, where: null, statement: s, db, environment }); }
    else if (first === "TRUNCATE") { const t = ident(s.match(/^TRUNCATE\s+(?:TABLE\s+)?([\w."`\[\]]+)/i)); ops.push({ type: "sql", op: "TRUNCATE", table: t, where: null, statement: s, db, environment }); }
    else if (first === "UPDATE") { const t = ident(s.match(/^UPDATE\s+([\w."`\[\]]+)/i)); const w = s.match(/\bWHERE\b([\s\S]+)$/i)?.[1]?.trim() ?? null; ops.push({ type: "sql", op: "UPDATE", table: t, where: w, statement: s, db, environment }); }
    else if (first === "ALTER" && /\bDROP\b/i.test(s)) { const t = ident(s.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."`\[\]]+)/i)); ops.push({ type: "sql", op: "ALTER", table: t, where: null, statement: s, db, environment }); }
    else ops.push({ type: "read", program: "sql:" + first.toLowerCase() });
  }
  return ops;
}

// ── shell ────────────────────────────────────────────────────────────────
function envOf(words: string[]): string | null {
  const joined = words.join(" ");
  if (/--prod\b|--production\b/.test(joined)) return "production";
  const m = joined.match(/(?:--env(?:ironment)?|--stage|--target|-e)[= ]([\w-]+)/) ?? joined.match(/\b(?:NODE_ENV|APP_ENV|ENV|ENVIRONMENT|STAGE)=([\w-]+)/);
  if (m) return m[1].toLowerCase();
  if (PROD_WORD.test(joined)) return "production";
  return null;
}

function shellSegment(words0: string[], cwd: string | undefined, git: () => { branch: string | null; upstream: string | null }): Op[] {
  let words = [...words0];
  const ops: Op[] = [];
  // leading VAR=value and wrappers
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
  while (words.length && ["env", "time", "nohup", "exec", "command", "nice"].includes(base(words[0]))) words.shift();
  if (words.length && base(words[0]) === "sudo") { ops.push({ type: "permission", detail: "sudo" }); words.shift(); while (words.length && isFlag(words[0])) words.shift(); }
  if (words.length && base(words[0]) === "npx") words.shift();
  if (!words.length) return ops;
  const prog0 = base(words[0]);
  const prog = prog0.startsWith("mkfs") ? "mkfs" : prog0;
  const args = words.slice(1);
  const joined = words.join(" ");
  const env = envOf(words);

  const secretArg = args.find((a) => !isFlag(a) && SECRET_PATH.test(a));

  switch (prog) {
    case "git": {
      const sub = args.find((a) => !isFlag(a)) ?? "";
      const rest = args.slice(args.indexOf(sub) + 1);
      if (sub === "push") {
        const force = rest.some((a) => a === "-f" || a === "--force" || a === "--force-with-lease" || a.startsWith("--force-with-lease=") || /^\+\S+$/.test(a));
        const deleteRef = rest.some((a) => a === "-d" || a === "--delete");
        const tags = rest.some((a) => a === "--tags");
        const pos = rest.filter((a) => !isFlag(a) && !a.startsWith("+")).concat(rest.filter((a) => /^\+\S+$/.test(a)).map((a) => a.slice(1)));
        let remote = pos[0] ?? null, ref = pos[1] ?? null;
        if (ref?.includes(":")) ref = ref.split(":")[1];
        if (!ref) { const g = git(); if (g.upstream) { const [r, ...b] = g.upstream.split("/"); remote = remote ?? r; ref = b.join("/"); } else if (g.branch) ref = g.branch; }
        ops.push({ type: "git_push", remote, ref, force, deleteRef, tags });
      } else if (sub === "merge") {
        const branch = rest.find((a) => !isFlag(a)) ?? null;
        ops.push({ type: "git_merge", branch, into: git().branch });
      } else if (sub === "reset" && rest.includes("--hard")) ops.push({ type: "git_rewrite", what: "reset --hard" });
      else if ((sub === "checkout" || sub === "restore") && (rest.includes(".") || rest.includes("--") && rest.length > 1 && !rest.some((a) => a === "-b"))) ops.push({ type: "git_rewrite", what: `${sub} (discard working changes)` });
      else if (sub === "clean" && rest.some((a) => /^-[a-zA-Z]*f/.test(a) || a === "--force")) ops.push({ type: "git_rewrite", what: "clean -f" });
      else if (sub === "branch" && rest.some((a) => a === "-D" || a === "--delete" && rest.includes("--force"))) ops.push({ type: "git_rewrite", what: "branch -D" });
      else if (sub === "filter-branch" || sub === "filter-repo") ops.push({ type: "git_rewrite", what: sub });
      else if (sub === "tag" && rest.includes("-d")) ops.push({ type: "git_rewrite", what: "tag -d" });
      else ops.push({ type: "read", program: "git " + sub });
      break;
    }
    case "rm": {
      const flags = args.filter(isFlag).join(" ");
      const recursive = /(^|\s)-[a-zA-Z]*[rR]|--recursive/.test(flags);
      const force = /(^|\s)-[a-zA-Z]*f|--force/.test(flags);
      const paths = args.filter((a) => !isFlag(a));
      for (const p of paths) {
        const abs = p.startsWith("~") ? p.replace(/^~/, os.homedir()) : path.resolve(cwd ?? "/", p.replace(/\/\*$/, ""));
        const home = os.homedir();
        if (p === "/" || p === "/*" || abs === "/" || abs === home || p === "~" || p === "~/" || p === "$HOME" || p === "${HOME}" || (recursive && (p === "." || p === "*" || p === "./") && (cwd === home || cwd === "/")))
          ops.push({ type: "catastrophic", detail: `rm ${flags} ${p}`.trim() });
      }
      ops.push({ type: "rm", paths, recursive, force });
      break;
    }
    case "find": {
      if (args.includes("-delete") || args.includes("-exec") && args.includes("rm")) ops.push({ type: "rm", paths: [args.find((a) => !isFlag(a)) ?? "."], recursive: true, force: true });
      else ops.push({ type: "read", program: "find" });
      break;
    }
    case "sqlite3": case "psql": case "mysql": case "sqlite": {
      const dbArg = prog === "sqlite3" || prog === "sqlite" ? args.find((a) => !isFlag(a) && !/^\s*(select|delete|drop|truncate|update|insert|alter|create)\b/i.test(a)) ?? null : null;
      const stmt = args.find((a) => /^\s*(select|delete|drop|truncate|update|insert|alter|create|with|pragma)\b/i.test(a));
      const ci = args.findIndex((a) => a === "-c" || a === "-e" || a === "--command");
      const sql = stmt ?? (ci >= 0 ? args[ci + 1] : null);
      if (sql) ops.push(...sqlOps(sql, dbArg, env)); else ops.push({ type: "exec", program: prog, args });
      break;
    }
    case "vercel": {
      if (args.includes("--prod") || args.includes("--production") || args.includes("promote") || args[0] === "rollback") ops.push({ type: "deploy", environment: "production", via: "vercel" });
      else if (args[0] === "deploy" || args.length === 0 || !isFlag(args[0]) && !["ls", "list", "logs", "inspect", "env", "domains", "whoami", "link", "pull", "dev", "build", "project", "teams", "alias", "certs", "dns", "git"].includes(args[0])) ops.push({ type: "deploy", environment: "preview", via: "vercel" });
      else if (["login", "logout"].includes(args[0])) ops.push({ type: "credential", action: "mutate", detail: "vercel " + args[0] });
      else if (args[0] === "env" && ["add", "rm", "remove", "pull"].includes(args[1])) ops.push({ type: "credential", action: args[1] === "pull" ? "expose" : "mutate", detail: joined });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "fly": case "flyctl": case "netlify": case "firebase": case "heroku": case "serverless": case "sls": case "wrangler": case "cap": case "eb": case "sam": case "cdk": case "pulumi": case "copilot": {
      if (args.includes("deploy") || args.includes("publish") || args.includes("up") || args.includes("release") || args.includes("apply")) ops.push({ type: "deploy", environment: env ?? (prog === "netlify" ? "preview" : null), via: prog });
      else if (args.includes("destroy") || args.includes("delete") || args.includes("down")) ops.push({ type: "deploy", environment: env, via: prog + " destroy" });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "kubectl": {
      if (["apply", "delete", "rollout", "scale", "patch", "replace", "drain", "cordon"].includes(args[0])) ops.push({ type: "deploy", environment: env ?? (args.find((a, i) => args[i - 1] === "--context" || args[i - 1] === "-n" || args[i - 1] === "--namespace") ?? null), via: "kubectl " + args[0] });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "terraform": case "tofu": {
      if (args.includes("apply") || args.includes("destroy")) ops.push({ type: "deploy", environment: env ?? args.find((a) => a.startsWith("-var-file"))?.split("=")[1] ?? null, via: `${prog} ${args.includes("destroy") ? "destroy" : "apply"}` });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "docker": {
      if (args[0] === "push") ops.push({ type: "publish", what: joined });
      else if (args[0] === "rm" || args[0] === "rmi" || args[0] === "system" && args[1] === "prune" || args[0] === "volume" && args[1] === "rm") ops.push({ type: "rm", paths: args.slice(1), recursive: true, force: args.includes("-f") });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "npm": case "pnpm": case "yarn": case "bun": {
      const sub = args[0] === "run" ? args[1] : args[0];
      if (sub === "publish") ops.push({ type: "publish", what: `${prog} publish` });
      else if (sub === "deploy" || sub === "release") ops.push({ type: "deploy", environment: env, via: `${prog} run ${sub}` });
      else if (sub === "unpublish" || sub === "deprecate") ops.push({ type: "publish", what: joined });
      else if (sub && /migrate|db:reset|db:drop/.test(sub)) ops.push({ type: "migration", direction: /reset|drop|rollback|down|undo/.test(sub) ? "reset" : "up", tool: joined });
      else if (args[0] === "login" || args[0] === "adduser" || args[0] === "token") ops.push({ type: "credential", action: "mutate", detail: joined });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "gh": {
      if (args[0] === "auth" && ["login", "logout", "refresh", "setup-git"].includes(args[1])) ops.push({ type: "credential", action: "mutate", detail: joined });
      else if (args[0] === "auth" && args[1] === "token") ops.push({ type: "credential", action: "expose", detail: joined });
      else if (args[0] === "release" && ["create", "upload", "edit"].includes(args[1])) ops.push({ type: "publish", what: joined });
      else if (args[0] === "repo" && ["delete", "archive", "rename", "edit"].includes(args[1])) ops.push({ type: "rm", paths: [args[2] ?? "repo"], recursive: true, force: true });
      else if (args[0] === "pr" && args[1] === "merge") ops.push({ type: "git_merge", branch: args[2] ?? null, into: "main" });
      else if (args[0] === "api" && (args.includes("-X") || args.includes("--method")) && /collaborators|permissions|teams|members|keys|secrets|tokens/.test(joined)) ops.push({ type: "permission", detail: joined });
      else if (args[0] === "secret" && ["set", "delete", "remove"].includes(args[1])) ops.push({ type: "credential", action: "mutate", detail: joined });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "aws": {
      if (args[0] === "iam" || args[0] === "sts" && args[1] === "assume-role" || args[0] === "configure" || args[0] === "sso") ops.push(args[0] === "configure" || args[0] === "sso" ? { type: "credential", action: "mutate", detail: joined } : { type: "permission", detail: joined });
      else if (args[0] === "s3" && (args[1] === "rm" || args[1] === "rb" || args[1] === "sync" && args.includes("--delete"))) ops.push({ type: "rm", paths: args.slice(2).filter((a) => !isFlag(a)), recursive: true, force: true });
      else if (/\b(deploy|update-function-code|update-stack|delete-stack|delete-|terminate-)/.test(joined)) ops.push({ type: "deploy", environment: env, via: joined.slice(0, 60) });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "gcloud": {
      if (/add-iam-policy-binding|remove-iam-policy-binding|service-accounts keys/.test(joined)) ops.push({ type: "permission", detail: joined });
      else if (args.includes("deploy") || args.includes("delete")) ops.push({ type: "deploy", environment: env, via: joined.slice(0, 60) });
      else if (args[0] === "auth") ops.push({ type: "credential", action: "mutate", detail: joined });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "supabase": {
      if (args[0] === "db" && args[1] === "push") ops.push({ type: "migration", direction: "up", tool: "supabase db push" });
      else if (args[0] === "db" && args[1] === "reset" && args.includes("--linked")) ops.push({ type: "migration", direction: "reset", tool: "supabase db reset --linked" });
      else if (args[0] === "secrets" && args[1] === "set" || args[0] === "login" || args[0] === "logout") ops.push({ type: "credential", action: "mutate", detail: joined });
      else if (args[0] === "projects" && args[1] === "delete") ops.push({ type: "rm", paths: [args[2] ?? "project"], recursive: true, force: true });
      else if (args[0] === "functions" && args[1] === "deploy") ops.push({ type: "deploy", environment: "production", via: "supabase functions deploy" });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "prisma": case "knex": case "alembic": case "drizzle-kit": case "sequelize": case "typeorm": case "rails": case "flyway": case "dbmate": case "goose": case "migrate": {
      if (/\b(reset|rollback|down|undo|drop|--accept-data-loss|db:drop)\b/.test(joined)) ops.push({ type: "migration", direction: "reset", tool: joined });
      else if (/\b(deploy|up|push|migrate|db:migrate)\b/.test(joined) && !/\bdev\b|status|generate|diff|create|new/.test(joined)) ops.push({ type: "migration", direction: "up", tool: joined });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "stripe": {
      if (/\b(charges|payment_intents|refunds|payouts|transfers|invoices|subscriptions)\b/.test(joined) && /\b(create|confirm|capture|pay|cancel|finalize|send|void)\b/.test(joined)) ops.push({ type: "payment", kind: /refund/.test(joined) ? "refund" : /payout/.test(joined) ? "payout" : /transfer/.test(joined) ? "transfer" : "charge", via: "stripe cli" });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "curl": case "wget": case "http": {
      const url = args.find((a) => /^https?:\/\//.test(a)) ?? "";
      const method = (args[args.findIndex((a) => a === "-X" || a === "--request") + 1] ?? "").toUpperCase();
      const hasBody = args.some((a) => /^(-d|--data|--data-binary|--data-raw|-F|--form|--json|-T|--upload-file)$/.test(a) || /^(-d|--data)/.test(a) && a.length > 2);
      const mutating = hasBody || ["POST", "PUT", "PATCH", "DELETE"].includes(method);
      if (/api\.stripe\.com/.test(url) && mutating) ops.push({ type: "payment", kind: /refund/.test(url) ? "refund" : /payout/.test(url) ? "payout" : "charge", via: "stripe api" });
      else if (/(api\.resend\.com|sendgrid|mailgun|postmarkapp|api\.mailchimp|api\.brevo|sparkpost)/.test(url) && mutating) ops.push({ type: "send", kind: "email", recipients: null, via: url.replace(/^https?:\/\//, "").split("/")[0] });
      else if (/(hooks\.slack\.com|api\.twilio\.com|discord\.com\/api\/webhooks|api\.telegram\.org)/.test(url) && mutating) ops.push({ type: "send", kind: "message", recipients: null, via: url.replace(/^https?:\/\//, "").split("/")[0] });
      else if (args.some((a) => /^(-d|--data|--data-binary|-F|-T|--upload-file)$/.test(a)) && args.some((a) => a.startsWith("@") && SECRET_PATH.test(a.slice(1)))) ops.push({ type: "credential", action: "exfiltrate", detail: "secret file sent over the network" });
      else if (mutating && env === "production") ops.push({ type: "exec", program: prog, args });
      else ops.push({ type: "read", program: prog });
      break;
    }
    case "chmod": case "chown": case "chgrp": {
      const mode = args.find((a) => !isFlag(a)) ?? "";
      if (prog !== "chmod" || /777|o\+w|a\+w|\+s|4755|2755|-R|--recursive/.test(joined) || /^[0-7]*[2367]$/.test(mode)) ops.push({ type: "permission", detail: joined });
      else if (secretArg) ops.push({ type: "credential", action: "mutate", detail: joined });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "ssh-keygen": case "gpg": case "security": case "keytool": case "certbot": case "op": case "pass": case "vault": {
      if (/\b(-w|find-generic-password|find-internet-password|export|--export-secret|read|get|kv get)\b/.test(joined)) ops.push({ type: "credential", action: "expose", detail: joined });
      else if (/\b(add|delete|import|--delete|rotate|renew|revoke|create|kv put|-f)\b/.test(joined) || prog === "ssh-keygen") ops.push({ type: "credential", action: "mutate", detail: joined });
      else ops.push({ type: "read", program: joined });
      break;
    }
    case "sendmail": case "mail": case "mutt": case "mailx": case "swaks": ops.push({ type: "send", kind: "email", recipients: null, via: prog }); break;
    case "cat": case "head": case "tail": case "less": case "more": case "bat": case "base64": case "xxd": case "strings": case "cp": case "scp": case "rsync": {
      if (secretArg) ops.push({ type: "credential", action: "expose", detail: `${prog} ${secretArg}` });
      else ops.push({ type: "read", program: prog });
      break;
    }
    case "printenv": case "env": case "set": ops.push({ type: "read", program: prog }); break;
    case "userdel": case "useradd": case "usermod": case "passwd": case "visudo": case "setfacl": case "iptables": case "ufw": case "launchctl": case "systemctl": ops.push({ type: "permission", detail: joined }); break;
    case "mkfs": case "dd": case "diskutil": case "fdisk": case "shutdown": case "reboot": case "halt": case "kill": case "killall": case "pkill": ops.push(prog === "kill" || prog === "killall" || prog === "pkill" ? { type: "exec", program: prog, args } : { type: "catastrophic", detail: joined }); break;
    default:
      ops.push(READ_PROGRAMS.has(prog) ? { type: "read", program: prog } : { type: "exec", program: prog, args });
  }
  return ops;
}

function shell(command: string, cwd?: string): { ops: Op[]; parse: "ok" | "failed" } {
  const tok = tokenize(command);
  let gitCache: { branch: string | null; upstream: string | null } | null = null;
  const git = () => (gitCache ??= gitInfo(cwd));
  if (!tok.ok) return { ops: [], parse: "failed" };
  const ops: Op[] = [];
  for (const seg of tok.segments) ops.push(...shellSegment(seg.words, cwd, git));
  // redirections were dropped by the tokenizer; a write into a secret file still counts
  const redir = command.match(/>\s*(\S+)/g) ?? [];
  for (const r of redir) { const target = r.replace(/^>+\s*/, "").replace(/^["']|["']$/g, ""); if (SECRET_PATH.test(target)) ops.push({ type: "credential", action: "mutate", detail: `write ${target}` }); }
  // `cat secret | curl …` — exposure plus network in one line is exfiltration
  if (ops.some((o) => o.type === "credential" && o.action === "expose") && tok.segments.some((s) => NETWORK.has(base(s.words[0] ?? "")))) ops.push({ type: "credential", action: "exfiltrate", detail: "secret read and network call in one line" });
  return { ops, parse: "ok" };
}

// ── MCP tools ────────────────────────────────────────────────────────────
function count(v: unknown): number | null {
  if (Array.isArray(v)) return v.length;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return v.split(/[,;\s]+/).filter(Boolean).length;
  return null;
}
function mcpOps(server: string, tool: string, args: Record<string, unknown>): Op[] {
  const env = typeof args.environment === "string" ? args.environment : typeof args.env === "string" ? args.env : typeof args.target === "string" ? args.target : null;
  const t = tool.toLowerCase();
  if (/^(deploy|release|promote|rollout)/.test(t)) return [{ type: "deploy", environment: env ?? (/prod/.test(t) ? "production" : null), via: `${server}.${tool}` }];
  if (/publish|unpublish|make_public|go_live/.test(t)) return [{ type: "publish", what: `${server}.${tool}` }];
  if (/^(send|email|mail|notify|broadcast|message|sms|text|dm)/.test(t) || /_(email|message|sms|notification)s?$/.test(t)) return [{ type: "send", kind: /mail/.test(t) ? "email" : "message", recipients: count(args.recipients ?? args.to ?? args.emails ?? args.users ?? args.recipient_count ?? args.count), via: `${server}.${tool}` }];
  if (/charge|refund|payout|transfer|invoice|payment|pay\b|bill/.test(t)) return [{ type: "payment", kind: /refund/.test(t) ? "refund" : /payout/.test(t) ? "payout" : /transfer/.test(t) ? "transfer" : "charge", via: `${server}.${tool}` }];
  if (/sql|query|execute/.test(t) && typeof (args.sql ?? args.query ?? args.statement) === "string") return sqlOps(String(args.sql ?? args.query ?? args.statement), typeof args.db === "string" ? args.db : typeof args.database === "string" ? args.database : null, env);
  if (/grant|revoke|permission|role|acl|access|share|invite|member/.test(t) && !/^(get|list|read|check)/.test(t)) return [{ type: "permission", detail: `${server}.${tool}` }];
  if (/(secret|credential|token|key|password|api_key)/.test(t) && !/^(get|list|read|check|verify)/.test(t)) return [{ type: "credential", action: /reveal|show|export|read/.test(t) ? "expose" : "mutate", detail: `${server}.${tool}` }];
  if (/(secret|credential|token|password)/.test(t) && /^(get|read|reveal|show|export)/.test(t)) return [{ type: "credential", action: "expose", detail: `${server}.${tool}` }];
  if (/migrat/.test(t)) return [{ type: "migration", direction: /reset|down|rollback|revert/.test(t) ? "reset" : "up", tool: `${server}.${tool}` }];
  if (/^(delete|remove|destroy|drop|truncate|purge|wipe|clear|reset|erase)/.test(t) || /_(delete|remove|destroy|purge|wipe)$/.test(t)) return [{ type: "rm", paths: [String(args.path ?? args.id ?? args.name ?? args.table ?? args.target ?? tool)], recursive: true, force: true }];
  if (/^(read|get|list|search|find|fetch|query|describe|show|check|view|lookup|count|status|ping|health|browse|open|load|resolve)/.test(t)) return [{ type: "read", program: `${server}.${tool}` }];
  return [{ type: "exec", program: `${server}.${tool}`, args: [] }];
}

// ── entry ────────────────────────────────────────────────────────────────
export function normalize(call: ToolCall): NormalizedAction {
  const { tool, input } = call;
  const cwd = call.cwd;
  if (tool === "Bash") {
    const command = String(input.command ?? "");
    const { ops, parse } = shell(command, cwd);
    return { tool, raw: command, ops, parse, production_hint: PROD_WORD.test(command) && !/^\s*(ls|cat|grep|rg|find|head|tail|less|git (status|diff|log|show|branch)|echo|printf|wc)\b/.test(command), input };
  }
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const p = String(input.file_path ?? input.notebook_path ?? "");
    const ops: Op[] = SECRET_PATH.test(p) ? [{ type: "credential", action: "mutate", detail: `${tool.toLowerCase()} ${p}` }] : [{ type: "file_write", path: p, tool }];
    return { tool, raw: `${tool.toLowerCase()} ${p}`, ops, parse: "ok", production_hint: false, input };
  }
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (m) {
    const [, server, name] = m;
    const argText = JSON.stringify(input);
    const ops = mcpOps(server, name, input);
    const show = (v: unknown): string => Array.isArray(v) ? `[${v.length} items]` : typeof v === "string" ? JSON.stringify(v.length > 48 ? v.slice(0, 47) + "…" : v) : typeof v === "object" && v ? "{…}" : String(v);
    const args = Object.entries(input).map(([k, v]) => `${k}: ${show(v)}`).join(", ");
    return { tool, raw: `${name}(${args})`, ops, parse: "ok", production_hint: PROD_WORD.test(argText) || /prod/.test(name), input };
  }
  // Read, Glob, Grep, WebFetch, Task, …: never consequential on their own
  return { tool, raw: tool, ops: [{ type: "read", program: tool }], parse: "ok", production_hint: false, input };
}

export const riskyLooking = (s: string) => RISKY.test(s);
