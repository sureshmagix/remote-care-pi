const test = require('node:test');
const assert = require('node:assert');
const {
  getPiModel,
  getCpuTemperature,
  getThrottledStatus,
  getLocalNetworkAddresses,
  getRaspberryPiDiagnostics
} = require('../src/main/pi-system');

test('getPiModel returns a valid model or OS description string', () => {
  const model = getPiModel();
  assert.strictEqual(typeof model, 'string');
  assert.ok(model.length > 0);
});

test('getLocalNetworkAddresses returns an array of network interfaces', () => {
  const addresses = getLocalNetworkAddresses();
  assert.ok(Array.isArray(addresses));
  for (const item of addresses) {
    assert.strictEqual(typeof item.interface, 'string');
    assert.strictEqual(typeof item.address, 'string');
  }
});

test('getThrottledStatus returns throttling status object', async () => {
  const status = await getThrottledStatus();
  assert.strictEqual(typeof status, 'object');
  assert.strictEqual(typeof status.healthy, 'boolean');
  assert.ok(Array.isArray(status.activeIssues));
  assert.ok(Array.isArray(status.historicalIssues));
});

test('getRaspberryPiDiagnostics returns complete system health metrics', async () => {
  const diag = await getRaspberryPiDiagnostics();
  assert.strictEqual(typeof diag, 'object');
  assert.strictEqual(typeof diag.model, 'string');
  assert.strictEqual(typeof diag.memory, 'object');
  assert.ok(diag.memory.totalBytes > 0);
  assert.ok(diag.uptimeSeconds >= 0);
  assert.ok(Array.isArray(diag.loadAvg));
  assert.ok(Array.isArray(diag.addresses));
});
