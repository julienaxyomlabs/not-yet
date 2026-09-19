// A minimal MCP server over stdio (newline-delimited JSON-RPC 2.0) that
// exposes the demo tools. Hand-rolled on purpose: ~60 lines, no SDK, easy
// to read. Claude Code sees these as mcp__notyet-demo__<tool>, and the
// PreToolUse hook pauses them like anything else.
import { createInterface } from "node:readline";
import { DEMO_TOOLS, type DemoToolName } from "./tools.js";

type Req = { jsonrpc: "2.0"; id?: number | string; method: string; params?: Record<string, unknown> };

export function runMcp(): void {
  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    let req: Req; try { req = JSON.parse(line); } catch { return; }
    const reply = (result: unknown) => req.id !== undefined && send({ jsonrpc: "2.0", id: req.id, result });
    const fail = (code: number, message: string) => req.id !== undefined && send({ jsonrpc: "2.0", id: req.id, error: { code, message } });
    switch (req.method) {
      case "initialize": return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "notyet-demo", version: "0.1.0" } });
      case "notifications/initialized": return;
      case "ping": return reply({});
      case "tools/list": return reply({ tools: Object.entries(DEMO_TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
      case "tools/call": {
        const name = String(req.params?.name ?? "") as DemoToolName;
        const tool = DEMO_TOOLS[name]; if (!tool) return fail(-32602, `unknown tool ${name}`);
        try { const r = await tool.run((req.params?.arguments as Record<string, unknown>) ?? {}); return reply({ content: [{ type: "text", text: r.text }], isError: !r.ok }); }
        catch (e) { return reply({ content: [{ type: "text", text: String(e) }], isError: true }); }
      }
      default: return fail(-32601, `method not found: ${req.method}`);
    }
  });
}
