#!/usr/bin/env node
// Captures the engine's tools/list into tools-snapshot.json, the file tests/drift.test.ts checks
// every plugin call against. The starting snapshot is a copy of lumberroom-openclaw's
// tools-snapshot.json, which is the engine's tools/list at the time that plugin captured it.
// Re-run this against a current engine when the tools change:
//   node scripts/capture-tools.mjs --url https://engine.example --token <bearer>
// then node scripts/snapshot-to-ts.mjs. --url is the engine's base URL; /mcp is appended.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const { values: a } = parseArgs({
  options: { url: { type: "string" }, token: { type: "string" }, out: { type: "string" } },
});
for (const k of ["url", "token"]) {
  if (!a[k]) {
    console.error(`--${k} is required`);
    process.exit(1);
  }
}
const out = a.out ?? new URL("../tools-snapshot.json", import.meta.url).pathname;

const authed = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${a.token}`);
  return fetch(input, { ...init, headers });
};

const client = new Client({ name: "lumberroom-claude-code-capture", version: "0.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(`${a.url.replace(/\/$/, "")}/mcp`), { fetch: authed });
try {
  await client.connect(transport);
} catch (e) {
  console.error(`handshake failed: ${e?.message ?? e}`);
  process.exit(2);
}
const listing = await client.listTools();
const snapshot = {
  protocolVersion: transport.protocolVersion ?? null,
  serverInfo: client.getServerVersion() ?? null,
  instructions: client.getInstructions() ?? null,
  tools: listing.tools,
};
await client.close();
writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`tools=${listing.tools.map((t) => t.name).join(",")}`);
