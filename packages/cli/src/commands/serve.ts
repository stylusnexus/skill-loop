/**
 * Start the skill-loop MCP server over stdio.
 *
 * Usage in MCP config:
 *   { "command": "npx", "args": ["@stylusnexus/skill-loop-cli", "serve"] }
 *
 * Or with a local build:
 *   { "command": "node", "args": ["path/to/cli/dist/index.js", "serve"] }
 */
export async function serveCommand(): Promise<void> {
  const { startMcpServer } = await import('../mcp-server.js');
  await startMcpServer();
}
