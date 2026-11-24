import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const spec = JSON.parse(await readFile(new URL('../../api/openapi/seeker.openapi.json', import.meta.url), 'utf8'));
const supportedVersion = '2025-11-25';
const operations = new Map();

for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    const body = operation.requestBody?.content['application/json'].schema;
    const properties = Object.fromEntries((operation.parameters ?? []).map(parameter => [parameter.name, {
      ...parameter.schema, ...(parameter.description ? { description: parameter.description } : {}),
    }]));
    Object.assign(properties, body?.properties ?? {});
    const required = [...(operation.parameters ?? []).filter(parameter => parameter.required).map(parameter => parameter.name), ...(body?.required ?? [])];
    operations.set(operation.operationId, {
      path, method, operation, body, tool: {
        name: operation.operationId, description: operation.description,
        inputSchema: { type: 'object', properties, required, additionalProperties: false },
        annotations: { readOnlyHint: method === 'get', openWorldHint: false },
      },
    });
  }
}

function valid(value, schema) {
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) return false;
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') return false;
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) return false;
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity) || !value.every(item => valid(item, schema.items))) return false;
  }
  return !schema.enum || schema.enum.includes(value);
}

export function createMcp(origin, secret, request = fetch) {
  const base = new URL(origin);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if (!['https:', ...(local ? ['http:'] : [])].includes(base.protocol) || base.href !== base.origin + '/' || !/^ska_[A-Za-z0-9_-]{43}$/.test(secret ?? '')) {
    throw new Error('Set SEEKER_API_URL to the API origin and SEEKER_AGENT_TOKEN to an agent credential.');
  }

  return async message => {
    const { id, method, params } = message ?? {};
    const response = result => ({ jsonrpc: '2.0', id, result });
    const error = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
    if (message?.jsonrpc !== '2.0' || typeof method !== 'string') return error(-32600, 'Invalid request');
    if (id === undefined) return null;
    if (method === 'initialize') return response({
      protocolVersion: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'].includes(params?.protocolVersion) ? params.protocolVersion : supportedVersion,
      capabilities: { tools: {} }, serverInfo: { name: 'dracula-seeker', version: '1.0.0' },
      instructions: 'Read an event revision before changing it. Keep the same request_key when retrying an import or verification job.',
    });
    if (method === 'ping') return response({});
    if (method === 'tools/list') return response({ tools: [...operations.values()].map(item => item.tool) });
    if (method !== 'tools/call') return error(-32601, 'Method not found');
    const item = operations.get(params?.name);
    const args = params?.arguments ?? {};
    if (!item || !args || typeof args !== 'object' || Array.isArray(args)) return error(-32602, 'Unknown tool or invalid arguments');
    const invalid = item.tool.inputSchema.required.find(name => !Object.hasOwn(args, name)) ??
      Object.keys(args).find(name => !Object.hasOwn(item.tool.inputSchema.properties, name) || !valid(args[name], item.tool.inputSchema.properties[name]));
    if (invalid) return error(-32602, `Invalid or missing argument: ${invalid}`);
    const url = new URL('/v1/seeker' + item.path.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(args[key])), base);
    for (const parameter of item.operation.parameters ?? []) {
      if (parameter.in === 'query' && Object.hasOwn(args, parameter.name)) url.searchParams.set(parameter.name, args[parameter.name]);
    }
    const body = item.body && Object.fromEntries(Object.keys(item.body.properties).filter(name => Object.hasOwn(args, name)).map(name => [name, args[name]]));
    try {
      const http = await request(url, {
        method: item.method.toUpperCase(), headers: { authorization: `Bearer ${secret}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body && JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      const result = await http.json();
      return response({ content: [{ type: 'text', text: JSON.stringify(result) }], ...(http.ok ? {} : { isError: true }) });
    } catch {
      return response({ content: [{ type: 'text', text: 'Seeker is unavailable. Reuse the same request_key when retrying a job.' }], isError: true });
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const handle = createMcp(process.env.SEEKER_API_URL || 'https://api.dracula.lt', process.env.SEEKER_AGENT_TOKEN);
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    input.on('line', async line => {
      let result;
      try { result = await handle(JSON.parse(line)); }
      catch { result = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
      if (result) process.stdout.write(JSON.stringify(result) + '\n');
    });
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
