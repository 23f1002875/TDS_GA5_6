const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json({ limit: '2mb' }));

const REGISTERED_EMAIL = '23f1002875@ds.study.iitm.ac.in'.trim().toLowerCase();
const PROTOCOL_VERSION_DEFAULT = '2025-06-18';

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ---------- MCP method handlers ----------

function handleInitialize(req, id) {
  const clientProtocolVersion =
    req.body && req.body.params && req.body.params.protocolVersion;
  return jsonRpcResult(id, {
    protocolVersion: clientProtocolVersion || PROTOCOL_VERSION_DEFAULT,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'solve-challenge-server',
      version: '1.0.0',
    },
  });
}

function handleToolsList(id) {
  return jsonRpcResult(id, {
    tools: [
      {
        name: 'solve_challenge',
        description:
          'Solves the exam challenge using the X-Exam-Challenge header from the current HTTP request.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ],
  });
}

function handleToolsCall(httpReq, id, params) {
  const name = params && params.name;
  if (name !== 'solve_challenge') {
    return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
  }

  const challenge = httpReq.headers['x-exam-challenge'];
  if (typeof challenge !== 'string' || challenge.length === 0) {
    return jsonRpcError(id, -32602, 'Missing X-Exam-Challenge header.');
  }

  const hash = crypto
    .createHash('sha256')
    .update(`${challenge}:${REGISTERED_EMAIL}`)
    .digest('hex')
    .slice(0, 16);

  return jsonRpcResult(id, {
    content: [
      {
        type: 'text',
        text: hash,
      },
    ],
  });
}

// ---------- single JSON-RPC message dispatch ----------

function dispatch(httpReq, message) {
  const { id, method, params } = message || {};

  switch (method) {
    case 'initialize':
      return handleInitialize(httpReq, id);
    case 'notifications/initialized':
      // Notification: no id, no response expected.
      return null;
    case 'tools/list':
      return handleToolsList(id);
    case 'tools/call':
      return handleToolsCall(httpReq, id, params);
    case 'ping':
      return jsonRpcResult(id, {});
    default:
      // Unknown notification (no id) -> no response. Unknown request -> error.
      if (id === undefined || id === null) return null;
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------- HTTP endpoint (Streamable HTTP, JSON response mode) ----------

app.post('/mcp', (req, res) => {
  try {
    const body = req.body;

    // Support both a single JSON-RPC message and a batch array.
    if (Array.isArray(body)) {
      const responses = body
        .map((msg) => dispatch(req, msg))
        .filter((r) => r !== null);
      if (responses.length === 0) {
        return res.status(202).end();
      }
      return res.status(200).json(responses);
    }

    const result = dispatch(req, body);
    if (result === null) {
      // Pure notification: no body expected.
      return res.status(202).end();
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json(jsonRpcError(null, -32700, 'Parse error.'));
  }
});

// Some clients probe GET for an SSE notification stream; we don't push
// server-initiated messages, so respond with 405 per spec (optional feature).
app.get('/mcp', (req, res) => {
  res.set('Allow', 'POST');
  res.status(405).send('Method Not Allowed: this server only supports POST for /mcp.');
});

app.delete('/mcp', (req, res) => {
  res.status(200).end();
});

app.get('/', (req, res) => res.send('MCP server is running. Endpoint: POST /mcp'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MCP server listening on port ${PORT}`));
