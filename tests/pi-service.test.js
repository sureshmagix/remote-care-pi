const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const serviceTemplate = fs.readFileSync(path.join(projectRoot, 'scripts', 'remote-care-pi.service'), 'utf8');
const installer = fs.readFileSync(path.join(projectRoot, 'scripts', 'install-service.sh'), 'utf8');

test('Raspberry Pi systemd template permits only database storage to be writable', () => {
  assert.match(serviceTemplate, /^Restart=on-failure$/m);
  assert.match(serviceTemplate, /^NoNewPrivileges=true$/m);
  assert.match(serviceTemplate, /^PrivateTmp=true$/m);
  assert.match(serviceTemplate, /^ProtectSystem=full$/m);
  assert.match(serviceTemplate, /^ReadWritePaths=\{\{DATA_DIR\}\}$/m);
  assert.match(serviceTemplate, /^RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6$/m);
});

test('Raspberry Pi installer renders all unit placeholders and requires Node 20+', () => {
  const replacements = {
    USER: 'pi',
    DIR: '/home/pi/remote-care-pi',
    DATA_DIR: '/home/pi/remote-care-pi/data',
    NODE_BIN: '/usr/bin/node'
  };
  const rendered = serviceTemplate.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key) => replacements[key]);

  assert.doesNotMatch(rendered, /\{\{[A-Z_]+\}\}/);
  assert.match(rendered, /^User=pi$/m);
  assert.match(rendered, /^WorkingDirectory=\/home\/pi\/remote-care-pi$/m);
  assert.match(rendered, /^ReadWritePaths=\/home\/pi\/remote-care-pi\/data$/m);
  assert.match(installer, /requires Node\.js 20 or later/);
  assert.match(installer, /setup_22\.x/);
});
