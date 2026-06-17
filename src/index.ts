#!/usr/bin/env node
/**
 * emailsRboring — a redacting policy proxy that fronts two Apple Mail MCP servers
 * (imdinu read/search + sweetrb write/organize) and presents one safe surface.
 *
 * Uses the LOW-LEVEL Server (not McpServer) so upstream JSON-Schema tool defs
 * forward verbatim; McpServer expects zod and would advertise empty params.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { startUpstreams } from "./upstreams.js";
import { buildSurface, type RawTool } from "./allowlist.js";
import { createRouter, type RouterConfig } from "./router.js";

function loadConfig(): RouterConfig {
  const fallback: RouterConfig = { sendAllowlist: [], fullBodyDefault: false };
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cfgPath = path.join(here, "..", "emailsRboring.config.json");
    const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    return {
      sendAllowlist: Array.isArray(raw.sendAllowlist) ? raw.sendAllowlist : [],
      fullBodyDefault: raw.fullBodyDefault === true,
    };
  } catch {
    return fallback; // missing/broken config → safe defaults
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const up = await startUpstreams();

  const [readList, writeList] = await Promise.all([
    up.read.listTools(),
    up.write.listTools(),
  ]);
  const { tools, routeOf } = buildSurface(
    readList.tools as RawTool[],
    writeList.tools as RawTool[]
  );
  const route = createRouter(up, routeOf, cfg);

  const server = new Server(
    { name: "emailsRboring-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    route(req.params.name, req.params.arguments as Record<string, unknown> | undefined)
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const nRead = [...routeOf.values()].filter((e) => e.route === "read").length;
  const nWrite = [...routeOf.values()].filter((e) => e.route === "write").length;
  console.error(
    `[emailsRboring] ready — ${tools.length} tools (${nRead} read / ${nWrite} write). ` +
      `send-allowlist: ${cfg.sendAllowlist.length ? cfg.sendAllowlist.join(",") : "off (confirm-only)"}`
  );

  const shutdown = async () => {
    await up.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[emailsRboring] fatal:", e);
  process.exit(1);
});
