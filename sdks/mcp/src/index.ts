#!/usr/bin/env node
/**
 * MCP server entry point for Stealth Scraper.
 *
 * Connects via stdio (the transport Claude Desktop / Cursor use by default).
 * The API key comes from the `STEALTH_SCRAPER_API_KEY` env var — we fail
 * fast with a clear message if it's missing so misconfiguration shows up
 * before the model issues the first tool call.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StealthClient } from "stealth-scraper";

import { TOOL_DEFS, dispatch } from "./tools.js";

const SERVER_NAME = "stealth-scraper";
const SERVER_VERSION = "0.1.0";

async function main(): Promise<void> {
  const apiKey = process.env.STEALTH_SCRAPER_API_KEY;
  if (!apiKey) {
    // stderr is the only safe channel for diagnostics on stdio transport —
    // stdout is reserved for the MCP wire protocol.
    process.stderr.write(
      "[stealth-scraper-mcp] STEALTH_SCRAPER_API_KEY env var is required.\n" +
        "Add it to your MCP client config, e.g. Claude Desktop:\n" +
        '  { "env": { "STEALTH_SCRAPER_API_KEY": "ssk_..." } }\n',
    );
    process.exit(1);
  }

  const baseUrl = process.env.STEALTH_SCRAPER_BASE_URL;
  const client = new StealthClient({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
  });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  // ListTools: return the static catalogue. The schemas are JSON Schema
  // objects so MCP clients can validate args before they hit the wire.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }));

  // CallTool: route to the dispatcher in tools.ts.
  // Cast to `any` so a future MCP SDK refactor of the ServerResult union
  // (Nov-2025 spec introduced an optional `task` field for streaming
  // progress notifications) doesn't break our build. Our ToolResult
  // shape is a strict subset of the accepted union.
  server.setRequestHandler(CallToolRequestSchema, (async (request: any) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    return dispatch(client, name, args);
  }) as any);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[stealth-scraper-mcp] connected via stdio (v${SERVER_VERSION})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[stealth-scraper-mcp] fatal: ${err}\n`);
  process.exit(1);
});
