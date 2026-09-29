const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { createHttpServer, isPortAvailable, findAvailablePort } = require('../src/server');
const { LocalDatabase } = require('../src/main/database');

test('HTTP server serves health check, static files, and full REST API lifecycle', async (t) => {
  const testDbDir = path.join(__dirname, '..', 'scratch_test_data');
  fs.mkdirSync(testDbDir, { recursive: true });
  const testDbPath = path.join(testDbDir, 'test-server.sqlite');

  process.env.DATABASE_PATH = testDbPath;
  const server = createHttpServer();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
    try { fs.rmSync(testDbDir, { recursive: true, force: true }); } catch {}
  });

  // 1. Health check
  const healthRes = await fetch(`${baseUrl}/health`);
  assert.strictEqual(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.status, 'ok');

  // 2. Static files
  const indexRes = await fetch(`${baseUrl}/`);
  assert.strictEqual(indexRes.status, 200);
  const indexHtml = await indexRes.text();
  assert.ok(indexHtml.includes('Remote Care Monitor'));
  assert.ok(indexHtml.includes('api-client.js'));

  const clientRes = await fetch(`${baseUrl}/api-client.js`);
  assert.strictEqual(clientRes.status, 200);
  const clientJs = await clientRes.text();
  assert.ok(clientJs.includes('window.remoteCare'));

  // 3. Setup state (before admin creation)
  const setupRes = await fetch(`${baseUrl}/api/setup-state`, { method: 'POST' });
  assert.strictEqual(setupRes.status, 200);
  const setupData = await setupRes.json();
  assert.strictEqual(setupData.requiresSetup, true);

  // 4. Setup admin
  const adminRes = await fetch(`${baseUrl}/api/setup-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      displayName: 'Super Administrator',
      password: 'AdminPassword123!'
    })
  });
  assert.strictEqual(adminRes.status, 200);
  const adminData = await adminRes.json();
  assert.ok(adminData.session?.token);
  const token = adminData.session.token;

  // 5. Dashboard
  const dashRes = await fetch(`${baseUrl}/api/dashboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  assert.strictEqual(dashRes.status, 200);
  const dashboard = await dashRes.json();
  assert.ok(dashboard.summary);
  assert.ok(Array.isArray(dashboard.targets));

  // 6. App Info (with Raspberry Pi metrics)
  const appInfoRes = await fetch(`${baseUrl}/api/app-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  assert.strictEqual(appInfoRes.status, 200);
  const appInfo = await appInfoRes.json();
  assert.ok(appInfo.version);
  assert.ok(appInfo.raspberryPi);
  assert.strictEqual(typeof appInfo.raspberryPi.model, 'string');
  assert.ok(appInfo.raspberryPi.memory.totalBytes > 0);

  // 7. Save Target
  const targetSaveRes = await fetch(`${baseUrl}/api/target-save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      target: {
        name: 'Local Port Check',
        type: 'tcp',
        host: '127.0.0.1',
        port: port,
        intervalSeconds: 10,
        timeoutMs: 1500,
        severity: 'warning'
      }
    })
  });
  assert.strictEqual(targetSaveRes.status, 200);
  const savedTarget = await targetSaveRes.json();
  assert.strictEqual(savedTarget.name, 'Local Port Check');

  // 8. Monthly Report Export
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const exportRes = await fetch(`${baseUrl}/api/history-export-monthly-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, month })
  });
  assert.strictEqual(exportRes.status, 200);
  const exportData = await exportRes.json();
  assert.strictEqual(exportData.cancelled, false);
  assert.ok(typeof exportData.csv === 'string');

  // 9. Direct download endpoint
  const downloadRes = await fetch(`${baseUrl}/download-report?token=${token}&month=${month}`);
  assert.strictEqual(downloadRes.status, 200);
  assert.strictEqual(downloadRes.headers.get('content-type'), 'text/csv; charset=utf-8');

  // 10. Logout
  const logoutRes = await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  assert.strictEqual(logoutRes.status, 200);
});

test('isPortAvailable correctly detects available and occupied ports', async (t) => {
  const dummyServer = http.createServer((req, res) => res.end('ok'));
  await new Promise((resolve) => dummyServer.listen(0, '127.0.0.1', resolve));
  const occupiedPort = dummyServer.address().port;

  t.after(() => dummyServer.close());

  const isOccupiedAvailable = await isPortAvailable(occupiedPort, '127.0.0.1');
  assert.strictEqual(isOccupiedAvailable, false);

  const freeTester = http.createServer();
  await new Promise((resolve) => freeTester.listen(0, '127.0.0.1', resolve));
  const freePort = freeTester.address().port;
  await new Promise((resolve) => freeTester.close(resolve));

  const isFreeAvailable = await isPortAvailable(freePort, '127.0.0.1');
  assert.strictEqual(isFreeAvailable, true);
});

test('findAvailablePort returns next available port when initial port is occupied', async (t) => {
  const dummyServer = http.createServer((req, res) => res.end('ok'));
  await new Promise((resolve) => dummyServer.listen(0, '127.0.0.1', resolve));
  const occupiedPort = dummyServer.address().port;

  t.after(() => dummyServer.close());

  const foundPort = await findAvailablePort(occupiedPort, '127.0.0.1');
  assert.notStrictEqual(foundPort, occupiedPort);
  assert.ok(foundPort > occupiedPort);
});
