#!/usr/bin/env node
/**
 * PC-005 throwaway logging hook (installed copy runs from the plugin cache).
 * Records where it ran from, all CLAUDE_* env, and exercises the plugin data
 * dir: writes a marker file into $CLAUDE_PLUGIN_DATA (if set) on every run so
 * an update can prove persistence.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE = '/tmp/pc005-hook-events.jsonl';
const eventLabel = process.argv[2] || 'UNLABELED';

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}

  const claudeEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('CLAUDE')) claudeEnv[k] = v;
  }

  // plugin-data persistence probe
  let dataProbe = null;
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (dataDir) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const marker = path.join(dataDir, 'pc005-marker.json');
      const existing = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : null;
      const record = {
        firstWrittenBy: existing ? existing.firstWrittenBy : `v${claudeEnv.CLAUDE_PLUGIN_VERSION || 'unknown'}`,
        firstWrittenAt: existing ? existing.firstWrittenAt : new Date().toISOString(),
        lastWrittenAt: new Date().toISOString(),
        writes: existing ? existing.writes + 1 : 1,
      };
      fs.writeFileSync(marker, JSON.stringify(record));
      dataProbe = { marker, ...record };
    } catch (err) {
      dataProbe = { error: err.message };
    }
  }

  fs.appendFileSync(EVIDENCE, JSON.stringify({
    ts: new Date().toISOString(),
    eventLabel,
    runningFrom: __dirname,
    claudeEnv,
    dataProbe,
    sessionId: parsed ? parsed.session_id : null,
  }) + '\n');
  process.exit(0);
});
