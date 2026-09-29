const { spawnSync } = require('node:child_process');
const path = require('node:path');

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { cwd: path.join(__dirname, '..'), stdio: 'inherit', env: environment });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const testFiles = [
  'tests/auth.test.js',
  'tests/checks.test.js',
  'tests/database.test.js',
  'tests/pi-system.test.js',
  'tests/pi-service.test.js',
  'tests/server.test.js'
];

run(process.execPath, ['--test', ...testFiles]);
