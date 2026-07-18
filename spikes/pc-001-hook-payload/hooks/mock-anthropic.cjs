#!/usr/bin/env node
/**
 * PC-001 throwaway mock Anthropic Messages API.
 *
 * Lets Claude Code complete "successful" turns with no real account:
 *   ANTHROPIC_BASE_URL=http://127.0.0.1:41100 ANTHROPIC_API_KEY=pc001 claude ...
 *
 * - Streams a minimal SSE completion ("pong") for POST /v1/messages.
 * - Logs every request body to evidence/api-requests.jsonl so we can prove
 *   whether hook stdout was injected into the model context.
 * - MOCK_DELAY_MS env var stretches the stream (for Esc-interrupt testing).
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.MOCK_PORT || 41100);
const DELAY_MS = Number(process.env.MOCK_DELAY_MS || 0);
const LOG = path.join(__dirname, '..', 'evidence', 'api-requests.jsonl');

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks).toString('utf8');
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(
      LOG,
      JSON.stringify({ ts: new Date().toISOString(), method: req.method, url: req.url, body: body.slice(0, 20000) }) + '\n',
    );

    if (!req.url.includes('/v1/messages')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const msgId = 'msg_pc001_' + Date.now();
    sse(res, 'message_start', {
      type: 'message_start',
      message: {
        id: msgId, type: 'message', role: 'assistant', model: 'claude-pc001-mock',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    });
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    if (DELAY_MS > 0) {
      // stretch the stream so an interactive Esc lands mid-turn
      const steps = 20;
      for (let i = 0; i < steps; i++) {
        sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'purr ' } });
        await new Promise((r) => setTimeout(r, DELAY_MS / steps));
        if (res.writableEnded || res.destroyed) return;
      }
    }
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } });
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
    sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    sse(res, 'message_stop', { type: 'message_stop' });
    res.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock anthropic api on 127.0.0.1:${PORT} (delay=${DELAY_MS}ms)`);
});
