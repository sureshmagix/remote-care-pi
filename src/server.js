const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const net = require('node:net');
const { LocalDatabase, ROLES } = require('./main/database');
const { verifyPassword, SessionStore } = require('./main/auth');
const { MonitorEngine } = require('./main/monitor-engine');
const { getNetworkAdapters, listDockerContainers } = require('./main/checks');
const { getRaspberryPiDiagnostics } = require('./main/pi-system');

const DEFAULT_PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'remote-care.sqlite');
const RENDERER_DIR = path.join(__dirname, 'renderer');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

/**
 * Checks whether a given TCP port is available on the specified host.
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (err) => {
      resolve(false);
    });
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

/**
 * Scans starting from startPort until an available port is found.
 * @param {number} startPort
 * @param {string} host
 * @param {number} maxAttempts
 * @returns {Promise<number>}
 */
async function findAvailablePort(startPort = DEFAULT_PORT, host = HOST, maxAttempts = 100) {
  const initial = Number.parseInt(startPort, 10) || 3000;
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidate = initial + offset;
    const available = await isPortAvailable(candidate, host);
    if (available) {
      return candidate;
    }
  }
  throw new Error(`No available port found between ${initial} and ${initial + maxAttempts - 1}.`);
}

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const sessions = new SessionStore();
let database;
let monitor;
let runtimeSessionId;
let pendingProtectedQuit = false;
let isShuttingDown = false;
const sseClients = new Set();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function monthlyReportCsv(report) {
  const line = (values) => values.map(csvCell).join(',');
  const lines = [
    line(['Remote Care Monitor — monthly monitoring report (Raspberry Pi)']),
    line(['Report month', report.month]),
    line(['Generated at (UTC)', report.generatedAt]),
    line(['Recorded result changes', report.summary.recordedChanges]),
    line(['Successful results', report.summary.successful]),
    line(['Failed results', report.summary.failed]),
    line(['Locations', report.locations.join('; ') || 'None']),
    line([]),
    line(['Checked at (UTC)', 'Location', 'Monitor', 'Type', 'Outcome', 'Status', 'Message', 'Latency (ms)', 'Details'])
  ];
  for (const result of report.results) {
    lines.push(line([
      result.checkedAt,
      result.locationName,
      result.targetName,
      result.targetType,
      result.ok ? 'Success' : 'Failure',
      result.status,
      result.message,
      result.latencyMs ?? '',
      JSON.stringify(result.details || {})
    ]));
  }
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

function requireSession(token, requiredRole = null) {
  const session = sessions.get(token);
  if (!session) {
    const error = new Error('Your session has expired. Please sign in again.');
    error.statusCode = 401;
    throw error;
  }
  if (requiredRole && session.role !== requiredRole) {
    const error = new Error('Super Admin access is required for this action.');
    error.statusCode = 403;
    throw error;
  }
  return session;
}

function broadcast(channel, payload) {
  const data = JSON.stringify(payload);
  const message = `event: ${channel}\ndata: ${data}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

function notify(event) {
  const settings = database?.getAppSettings();
  const enabled = ['down', 'warning'].includes(event.kind)
    ? settings?.showFailureNotifications
    : settings?.showRecoveryNotifications;
  if (!enabled) return;
  broadcast('monitor-update', { type: 'notification', event });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large.'));
      }
    });
    req.once('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON request body.'));
      }
    });
    req.once('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  res.end(JSON.stringify(data));
}

function sendError(res, error) {
  const statusCode = error.statusCode || 400;
  sendJson(res, statusCode, { error: error.message || 'An unknown error occurred.' });
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const headers = {
      'Content-Type': contentType,
      'Content-Length': stats.size
    };
    if (['.html', '.js', '.css'].includes(ext)) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    } else {
      headers['Cache-Control'] = 'public, max-age=86400';
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApiRequest(req, res, pathname) {
  const action = pathname.replace(/^\/api\//, '');
  let body = {};
  if (req.method === 'POST') {
    body = await parseJsonBody(req);
  }

  switch (action) {
    case 'setup-state': {
      return sendJson(res, 200, database.getSetupState());
    }

    case 'setup-admin': {
      const user = database.createInitialAdmin(body || {});
      database.createDefaultTargets();
      monitor.refreshSchedule(true);
      monitor.start();
      const session = sessions.issue(user);
      database.markLogin(user.id);
      database.audit(user.id, 'login', 'session', session.token, {});
      return sendJson(res, 200, { session });
    }

    case 'login': {
      const candidate = database.getUserForLogin(body?.username || '');
      if (
        !candidate ||
        !candidate.active ||
        !verifyPassword(body?.password || '', candidate.passwordSalt, candidate.passwordHash)
      ) {
        throw new Error('Invalid username or password.');
      }
      const user = database.getUserById(candidate.id);
      const session = sessions.issue(user);
      database.markLogin(user.id);
      database.audit(user.id, 'login', 'session', session.token, {});
      return sendJson(res, 200, { session });
    }

    case 'logout': {
      const session = requireSession(body.token);
      database.audit(session.userId, 'logout', 'session', body.token, {});
      sessions.revoke(body.token);
      return sendJson(res, 200, { ok: true });
    }

    case 'dashboard': {
      requireSession(body.token);
      return sendJson(res, 200, monitor.dashboard());
    }

    case 'history-list': {
      requireSession(body.token);
      return sendJson(res, 200, database.listCheckHistory(body.filters || {}));
    }

    case 'history-export-monthly-report': {
      const session = requireSession(body.token);
      const report = database.getMonthlyReport(body.month);
      const csv = monthlyReportCsv(report);
      database.audit(session.userId, 'export_monthly_history_report', 'check_history', report.month, {
        month: report.month,
        recordedChanges: report.summary.recordedChanges
      });
      return sendJson(res, 200, {
        cancelled: false,
        rowCount: report.summary.recordedChanges,
        month: report.month,
        csv
      });
    }

    case 'notification-test': {
      const session = requireSession(body.token, ROLES.SUPER_ADMIN);
      const event = {
        kind: 'warning',
        title: 'Test Alert (Raspberry Pi)',
        body: 'This confirms that Remote Care Monitor web alerts and notifications are operating correctly.',
        target: { name: 'Alert test', locationName: 'Raspberry Pi', severity: 'warning' },
        occurredAt: new Date().toISOString()
      };
      database.audit(session.userId, 'test_desktop_notification', 'application', null, {});
      broadcast('monitor-update', { type: 'notification', event });
      return sendJson(res, 200, { ok: true });
    }

    case 'network-adapters': {
      requireSession(body.token);
      const adapters = await getNetworkAdapters();
      return sendJson(res, 200, adapters);
    }

    case 'docker-containers': {
      requireSession(body.token);
      const containers = await listDockerContainers();
      return sendJson(res, 200, containers);
    }

    case 'target-save': {
      const session = requireSession(body.token, ROLES.SUPER_ADMIN);
      const saved = database.saveTarget(body.target, session.userId);
      monitor.refreshSchedule(true);
      broadcast('monitor-update', { type: 'target_saved', targetId: saved.id });
      return sendJson(res, 200, saved);
    }

    case 'target-delete': {
      const session = requireSession(body.token, ROLES.SUPER_ADMIN);
      database.deleteTarget(Number(body.targetId), session.userId);
      monitor.refreshSchedule(false);
      broadcast('monitor-update', { type: 'target_deleted', targetId: Number(body.targetId) });
      return sendJson(res, 200, { ok: true });
    }

    case 'target-run': {
      requireSession(body.token, ROLES.SUPER_ADMIN);
      const outcome = await monitor.runNow(Number(body.targetId));
      return sendJson(res, 200, outcome);
    }

    case 'incident-acknowledge': {
      const session = requireSession(body.token, ROLES.SUPER_ADMIN);
      database.acknowledgeIncident(Number(body.incidentId), session.userId);
      broadcast('monitor-update', { type: 'incident_acknowledged', incidentId: Number(body.incidentId) });
      return sendJson(res, 200, { ok: true });
    }

    case 'users-list': {
      requireSession(body.token, ROLES.SUPER_ADMIN);
      return sendJson(res, 200, database.listUsers());
    }

    case 'viewer-create': {
      const session = requireSession(body.token, ROLES.SUPER_ADMIN);
      const created = database.createViewer(body.user || {}, session.userId);
      broadcast('monitor-update', { type: 'viewer_created', userId: created.id });
      return sendJson(res, 200, created);
    }

    case 'viewer-set-active': {
      const session = requireSession(body.token, ROLES.SUPER_ADMIN);
      const user = database.setViewerActive(Number(body.userId), Boolean(body.active), session.userId);
      if (!user.active) sessions.revokeUser(user.id);
      broadcast('monitor-update', { type: 'viewer_updated', userId: user.id });
      return sendJson(res, 200, user);
    }

    case 'viewer-reset-password': {
      const session = requireSession(body.token, ROLES.SUPER_ADMIN);
      database.resetViewerPassword(Number(body.userId), body.password, session.userId);
      sessions.revokeUser(Number(body.userId));
      return sendJson(res, 200, { ok: true });
    }

    case 'user-change-password': {
      const session = requireSession(body.token);
      database.changeUserPassword(session.userId, body.currentPassword, body.newPassword);
      return sendJson(res, 200, { ok: true });
    }

    case 'user-update-profile': {
      const session = requireSession(body.token);
      const updated = database.updateUserProfile(session.userId, body.profile || {});
      session.displayName = updated.displayName;
      session.username = updated.username;
      broadcast('monitor-update', { type: 'profile_updated', user: updated });
      return sendJson(res, 200, updated);
    }

    case 'viewer-update': {
      const session = requireSession(body.token, ROLES.SUPER_ADMIN);
      const updated = database.updateViewer(Number(body.userId), body.updates || {}, session.userId);
      if (!updated.active) sessions.revokeUser(updated.id);
      broadcast('monitor-update', { type: 'viewer_updated', userId: updated.id });
      return sendJson(res, 200, updated);
    }

    case 'app-settings': {
      requireSession(body.token);
      return sendJson(res, 200, database.getAppSettings());
    }

    case 'app-settings-save': {
      const session = requireSession(body.token, ROLES.SUPER_ADMIN);
      const saved = database.updateAppSettings(body.settings, session.userId);
      broadcast('monitor-update', { type: 'app_settings_updated', settings: saved });
      return sendJson(res, 200, saved);
    }

    case 'app-control-state': {
      const session = requireSession(body.token);
      return sendJson(res, 200, {
        pendingProtectedQuit,
        canAuthorizeQuit: session.role === ROLES.SUPER_ADMIN
      });
    }

    case 'quit-with-password': {
      const session = requireSession(body.token, ROLES.SUPER_ADMIN);
      const source = body.source || 'application';
      if (!database.verifySuperAdminPassword(session.userId, body.password || '')) {
        database.audit(session.userId, 'failed_protected_quit', 'application', null, { source });
        throw new Error('Incorrect Super Admin password.');
      }
      database.audit(session.userId, 'authorized_protected_quit', 'application', null, { source });
      pendingProtectedQuit = false;
      sendJson(res, 200, { ok: true, message: 'Server is stopping gracefully.' });
      setTimeout(() => gracefulShutdown('super_admin_request'), 500);
      return;
    }

    case 'cancel-protected-quit': {
      const session = requireSession(body.token);
      if (pendingProtectedQuit) {
        database.audit(session.userId, 'cancelled_protected_quit', 'application', null, {});
      }
      pendingProtectedQuit = false;
      return sendJson(res, 200, { ok: true });
    }

    case 'app-info': {
      requireSession(body.token);
      const pkg = require('../package.json');
      const piDiag = await getRaspberryPiDiagnostics();
      const autostartMsg = fs.existsSync('/etc/systemd/system/remote-care-pi.service')
        ? 'Active via systemd (remote-care-pi.service)'
        : 'Manual / Standalone process (run scripts/install-service.sh for auto-boot)';

      return sendJson(res, 200, {
        version: pkg.version,
        platform: `${process.platform} (${piDiag.model})`,
        arch: process.arch,
        dataPath: DATABASE_PATH,
        cloudSync: 'Phase 2 disabled (local-first monitoring)',
        runtime: database.getRuntimeStatus(),
        autostart: { enabled: true, message: autostartMsg },
        raspberryPi: piDiag
      });
    }

    case 'pi-diagnostics': {
      requireSession(body.token);
      const diagnostics = await getRaspberryPiDiagnostics();
      return sendJson(res, 200, diagnostics);
    }

    default:
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown endpoint: ${action}` }));
  }
}

function handleSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  });
  res.write(': connected\n\n');

  const client = { req, res };
  sseClients.add(client);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(client);
    }
  }, 15000);
  heartbeat.unref?.();

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
}

function createHttpServer(options = {}) {
  if (options.database) {
    database = options.database;
  } else if (!database) {
    database = new LocalDatabase(process.env.DATABASE_PATH || DATABASE_PATH);
  }
  if (options.monitor) {
    monitor = options.monitor;
  } else if (!monitor) {
    monitor = new MonitorEngine({ database, notify });
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      // Health check endpoint
      if (pathname === '/health') {
        return sendJson(res, 200, {
          status: 'ok',
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString()
        });
      }

      // Server-Sent Events stream
      if (pathname === '/api/events') {
        // EventSource cannot attach a request body or custom authorization
        // header, so its session token is carried in the same-origin URL.
        // Do not allow unauthenticated clients to observe monitor names,
        // addresses, notifications, or state transitions on the LAN.
        requireSession(url.searchParams.get('token'));
        return handleSse(req, res);
      }

      // API Routes
      if (pathname.startsWith('/api/')) {
        return await handleApiRequest(req, res, pathname);
      }

      // Direct CSV export download route
      if (pathname === '/download-report') {
        const token = url.searchParams.get('token');
        const month = url.searchParams.get('month');
        requireSession(token);
        const report = database.getMonthlyReport(month);
        const csv = monthlyReportCsv(report);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="Remote-Care-Report-${report.month}.csv"`,
          'Cache-Control': 'no-cache'
        });
        res.end(csv);
        return;
      }

      // Static assets
      if (pathname.startsWith('/assets/')) {
        const assetPath = path.join(ASSETS_DIR, path.basename(pathname));
        return serveStatic(res, assetPath);
      }

      // Frontend renderer files
      let filePath;
      if (pathname === '/' || pathname === '/index.html') {
        filePath = path.join(RENDERER_DIR, 'index.html');
      } else {
        filePath = path.join(RENDERER_DIR, path.basename(pathname));
      }

      if (fs.existsSync(filePath)) {
        return serveStatic(res, filePath);
      }

      // Fallback to index.html for single-page app routes
      return serveStatic(res, path.join(RENDERER_DIR, 'index.html'));
    } catch (error) {
      sendError(res, error);
    }
  });
}

function gracefulShutdown(reason = 'signal') {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\nStopping Remote Care Monitor (${reason})...`);

  for (const client of sseClients) {
    try {
      client.res.end(': server shutting down\n\n');
    } catch {}
  }
  sseClients.clear();

  try {
    database?.endRuntimeSession(runtimeSessionId, reason);
    monitor?.stop();
    database?.close();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }

  process.exit(0);
}

function printStartupBanner(port, host) {
  const interfaces = os.networkInterfaces();
  const lanIps = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        lanIps.push({ name, ip: iface.address });
      }
    }
  }

  console.log('');
  console.log('\x1b[36m%s\x1b[0m', '  ==============================================================');
  console.log('\x1b[1m\x1b[32m%s\x1b[0m', '    Remote Care Monitor — Raspberry Pi Edition');
  console.log('\x1b[36m%s\x1b[0m', '  ==============================================================');
  console.log('    Local Dashboard:    \x1b[33mhttp://localhost:' + port + '\x1b[0m');
  if (lanIps.length > 0) {
    for (const item of lanIps) {
      console.log(`    Network (${item.name}):    \x1b[1m\x1b[32mhttp://${item.ip}:${port}\x1b[0m`);
    }
  } else {
    console.log(`    Network:            \x1b[33mhttp://<your-pi-ip>:${port}\x1b[0m`);
  }
  console.log(`    mDNS (Bonjour):     \x1b[33mhttp://${os.hostname()}.local:${port}\x1b[0m`);
  console.log('    Database:           ' + DATABASE_PATH);
  console.log('\x1b[36m%s\x1b[0m', '  ==============================================================');
  console.log('    Connect any device on the same Wi-Fi/LAN to the network URL.');
  console.log('    Press Ctrl+C to stop.\n');
}

async function start(options = {}) {
  const requestedPort = Number.parseInt(options.port || process.env.PORT || DEFAULT_PORT, 10);
  const host = options.host || HOST;
  const dbPath = options.databasePath || DATABASE_PATH;

  const activePort = await findAvailablePort(requestedPort, host);
  if (activePort !== requestedPort) {
    console.log(`\n\x1b[33m[Notice]\x1b[0m Port ${requestedPort} is currently in use by another process.`);
    console.log(`\x1b[32m[Notice]\x1b[0m Automatically switched to available port: \x1b[1m\x1b[32m${activePort}\x1b[0m`);
  }

  database = new LocalDatabase(dbPath);
  runtimeSessionId = crypto.randomUUID();
  database.startRuntimeSession(runtimeSessionId, {
    version: require('../package.json').version,
    platform: `${process.platform} (${os.arch()})`,
    startedInBackground: true
  });

  monitor = new MonitorEngine({ database, notify });
  monitor.on('update', (event) => broadcast('monitor-update', event));

  if (database.hasSuperAdmin()) {
    database.createDefaultTargets();
    monitor.start();
  }

  const server = createHttpServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(activePort, host, () => {
      printStartupBanner(activePort, host);
      resolve();
    });
  });

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  return { server, database, monitor, port: activePort, host };
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = {
  start,
  createHttpServer,
  monthlyReportCsv,
  isPortAvailable,
  findAvailablePort,
  DEFAULT_PORT
};
