import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(appRoot, 'scripts');
const mode = String(process.env.FUEL_AGENT_MODE || 'vehicle-balance-report').trim();
const cronSecret = String(process.env.CRON_SECRET || '').trim();
const artifactDir = path.resolve(process.env.FUEL_SYNC_ARTIFACT_DIR || path.join(appRoot, 'artifacts'));

function required(value, name) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function runNode(scriptName, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(scriptsDir, scriptName)], {
      cwd: appRoot,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${scriptName} exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}.`));
    });
  });
}

function readOutputs(text) {
  const outputs = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    outputs[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return outputs;
}

async function main() {
  required(cronSecret, 'CRON_SECRET');
  required(String(process.env.NOOR_KHOY_USERNAME || '').trim(), 'NOOR_KHOY_USERNAME');
  required(String(process.env.NOOR_KHOY_PASSWORD || ''), 'NOOR_KHOY_PASSWORD');
  if (!['daily-report', 'vehicle-balance-report'].includes(mode)) {
    throw new Error(`Unsupported FUEL_AGENT_MODE: ${mode}`);
  }

  await fs.mkdir(artifactDir, { recursive: true });
  const requestToken = crypto.randomBytes(32).toString('hex');
  const server = http.createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${requestToken}`) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ value: cronSecret }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local token service did not start.');
    const commonEnv = {
      ...process.env,
      ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${address.port}/token`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken,
      BINHAMID_FUEL_UPLOAD_URL: process.env.BINHAMID_FUEL_UPLOAD_URL || 'https://binhamid-factory-control.vercel.app/api/fuel/daily-report',
      FUEL_SYNC_ARTIFACT_DIR: artifactDir,
    };

    const outputPath = path.join(artifactDir, 'delivery-status-output.txt');
    await fs.writeFile(outputPath, '', 'utf8');
    await runNode('check-fuel-delivery-status.mjs', {
      ...commonEnv,
      GITHUB_OUTPUT: outputPath,
      FUEL_STATUS_KIND: mode,
      FUEL_STATUS_DATE_OFFSET_DAYS: mode === 'daily-report' ? '-1' : '0',
    });
    const outputs = readOutputs(await fs.readFile(outputPath, 'utf8'));
    if (outputs.needed === 'false') {
      console.log(JSON.stringify({ ok: true, skipped: true, reason: 'already-delivered', mode, reportDate: outputs.report_date || null, deliveredAt: outputs.delivered_at || null }, null, 2));
      return;
    }

    await runNode('noor-khoy-fuel-sync.mjs', {
      ...commonEnv,
      FUEL_SYNC_MODE: mode,
      FUEL_NOTIFY: 'true',
      FUEL_SEND_BALANCE: 'true',
      FUEL_REPORT_DATE_OFFSET_DAYS: '-1',
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error('[local-fuel-agent]', error?.stack || error);
  process.exitCode = 1;
});
