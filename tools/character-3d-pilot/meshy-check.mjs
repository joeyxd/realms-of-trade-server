import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Read-only MCP handshake and account check. This script cannot submit jobs.
const root = fileURLToPath(new URL('../../', import.meta.url));
const installation = process.env.MESHY_MCP_DIR || path.join(os.homedir(), '.codex', 'mcp', 'meshy');
const modulePath = (...parts) => pathToFileURL(path.join(installation, 'node_modules', ...parts)).href;
const { Client } = await import(modulePath('@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'index.js'));
const { StdioClientTransport } = await import(modulePath('@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'stdio.js'));
const { ImageTo3DInputSchema } = await import(modulePath('@meshy-ai', 'meshy-mcp-server', 'dist', 'schemas', 'generation.js'));
const serverEntry = path.join(installation, 'node_modules', '@meshy-ai', 'meshy-mcp-server', 'dist', 'index.js');
const source = 'docs/art/source/character-alpha-v1/male-scout-master-v1.png';
const sourceFile = path.join(root, source);
const input = await fs.readFile(sourceFile);
const args = ImageTo3DInputSchema.parse({
  file_path: sourceFile,
  ai_model: 'meshy-7.1',
  model_type: 'standard',
  geometry_resolution: 'standard',
  pose_mode: 't-pose',
  topology: 'triangle',
  target_polycount: 15000,
  should_remesh: true,
  should_texture: true,
  texture_resolution: '2k',
  enable_pbr: false,
  image_enhancement: false,
  save_pre_remeshed_model: true,
  target_formats: ['glb'],
  response_format: 'json'
});
const receipt = {
  schema: 'mn-character-3d-pilot-preflight/v1',
  checkedAt: new Date().toISOString(),
  package: '@meshy-ai/meshy-mcp-server',
  version: JSON.parse(await fs.readFile(path.join(installation, 'node_modules', '@meshy-ai', 'meshy-mcp-server', 'package.json'), 'utf8')).version,
  transport: 'stdio',
  input: { source, sha256: crypto.createHash('sha256').update(input).digest('hex'), bytes: input.length, width: input.readUInt32BE(16), height: input.readUInt32BE(20) },
  proposedRequest: { tool: 'meshy_image_to_3d', arguments: { ...args, file_path: source }, estimatedCredits: 30, priceSource: 'https://docs.meshy.ai/en/api/pricing', submitted: false },
  generationRequests: 0,
  balanceRequest: 'not-attempted',
  authenticated: false,
  generationStatus: 'not-submitted'
};
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string'));
// The provider loads installation/.env itself. No secret enters the receipt.
const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry], cwd: installation, env, stderr: 'pipe' });
const client = new Client({ name: 'mn-character-3d-preflight', version: '1.0.0' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  receipt.handshake = 'pass';
  receipt.tools = tools.map(t => t.name).sort();
  const needed = ['meshy_image_to_3d', 'meshy_multi_image_to_3d', 'meshy_get_task_status', 'meshy_download_model', 'meshy_remesh', 'meshy_rig', 'meshy_check_balance'];
  receipt.requiredToolsPresent = needed.every(name => receipt.tools.includes(name));
  receipt.requestSchema = 'pass';
  const balance = await client.callTool({ name: 'meshy_check_balance', arguments: { response_format: 'json' } });
  const message = (balance.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  if (balance.isError) {
    receipt.balanceRequest = /environment variable is required/i.test(message) ? 'missing-api-key' : /401|Authentication failed/i.test(message) ? 'authentication-rejected' : 'provider-error';
  } else {
    const data = balance.structuredContent || JSON.parse(message);
    if (!Number.isFinite(data.balance)) throw new Error('invalid-balance');
    receipt.balanceRequest = 'pass';
    receipt.authenticated = true;
    receipt.balanceCredits = data.balance;
  }
  receipt.status = receipt.requiredToolsPresent ? (receipt.authenticated ? 'ready' : 'installed-auth-pending') : 'missing-tools';
} catch {
  // Avoid printing transport errors that could contain headers or credentials.
  receipt.status = 'preflight-failed';
} finally {
  await client.close().catch(() => {});
}
const out = path.join(root, 'docs', 'art', 'character-3d-pilot-v1', 'meshy-preflight.json');
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ status: receipt.status, version: receipt.version, handshake: receipt.handshake, tools: receipt.tools?.length, balance: receipt.balanceRequest, requestSchema: receipt.requestSchema, submitted: false, receipt: path.relative(root, out) }, null, 2));
if (receipt.status === 'preflight-failed' || receipt.status === 'missing-tools') process.exitCode = 1;
