#!/usr/bin/env node

/**
 * Remote Care Monitor — Tools Exploration & Diagnostics CLI
 * Tests all internal tools: Port Check, Network Adapters, Gateway,
 * Ping, TCP Port Probe, HTTP Check, and Hardware Diagnostics.
 */

const { isPortAvailable, findAvailablePort, DEFAULT_PORT } = require('../src/server');
const {
  getNetworkAdapters,
  getDefaultGateway,
  checkPing,
  checkTcp,
  checkHttp
} = require('../src/main/checks');
const { getRaspberryPiDiagnostics } = require('../src/main/pi-system');

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

function header(title) {
  console.log(`\n${colors.cyan}${colors.bold}=== ${title} ===${colors.reset}`);
}

async function main() {
  console.log(`${colors.bold}${colors.green}Remote Care Monitor — Tools Exploration CLI${colors.reset}`);
  console.log(`${colors.dim}Probing local facilities, network tools, and system diagnostics...${colors.reset}`);

  // 1. Port Availability Tool
  header('1. Port Availability & Auto-Selection Tool');
  const targetPort = DEFAULT_PORT || 3000;
  const isTargetFree = await isPortAvailable(targetPort);
  console.log(`Port ${colors.bold}${targetPort}${colors.reset} available:`, isTargetFree ? `${colors.green}YES (Free)${colors.reset}` : `${colors.yellow}NO (In Use)${colors.reset}`);
  const nextFreePort = await findAvailablePort(targetPort);
  console.log(`Next available listening port: ${colors.bold}${colors.green}${nextFreePort}${colors.reset}`);

  // 2. Hardware Diagnostics Tool
  header('2. Hardware & System Diagnostics Tool');
  const diag = await getRaspberryPiDiagnostics();
  const totalMB = Math.round(diag.memory.totalBytes / (1024 * 1024));
  const freeMB = Math.round(diag.memory.freeBytes / (1024 * 1024));
  console.log(`Device Model:    ${colors.bold}${diag.model}${colors.reset}`);
  console.log(`CPU Temperature: ${diag.cpuTemperature !== null ? `${diag.cpuTemperature} °C` : 'N/A'}`);
  console.log(`CPU Cores:       ${diag.cpuCount}`);
  console.log(`System Load:     ${(diag.loadAvg || []).join(', ')}`);
  console.log(`Memory:          ${freeMB} MB free / ${totalMB} MB total (${diag.memory.usedPercent}% used)`);
  if (diag.throttled) {
    console.log(`Throttling:      ${diag.throttled.throttled ? `${colors.red}Under-voltage detected${colors.reset}` : `${colors.green}Optimal power (${diag.throttled.code})${colors.reset}`}`);
  }

  // 3. Network Adapters Tool
  header('3. Network Adapters Facility');
  try {
    const adapters = await getNetworkAdapters();
    if (adapters.length === 0) {
      console.log('No physical adapters detected.');
    } else {
      for (const a of adapters) {
        const stateColor = a.connected ? colors.green : colors.dim;
        console.log(`• Interface: ${colors.bold}${a.name}${colors.reset} [${a.kind}] — Status: ${stateColor}${a.state}${colors.reset} (MAC: ${a.mac || 'N/A'})`);
      }
    }
  } catch (err) {
    console.log(`Error reading adapters: ${err.message}`);
  }

  // 4. Default Gateway Tool
  header('4. Default Gateway Facility');
  try {
    const gw = await getDefaultGateway();
    if (gw) {
      console.log(`Default Gateway IP: ${colors.bold}${gw.gateway}${colors.reset} via ${gw.interfaceName}`);
    } else {
      console.log('Default gateway not found or offline.');
    }
  } catch (err) {
    console.log(`Error resolving gateway: ${err.message}`);
  }

  // 5. ICMP Ping Probe Tool
  header('5. ICMP Ping Probe Tool');
  try {
    const pingTarget = '8.8.8.8';
    console.log(`Pinging ${pingTarget}...`);
    const pingRes = await checkPing(pingTarget, 3000);
    const pingColor = pingRes.ok ? colors.green : colors.red;
    console.log(`Result: ${pingColor}${pingRes.message}${colors.reset} (${pingRes.latencyMs || 0} ms)`);
  } catch (err) {
    console.log(`Ping failed: ${err.message}`);
  }

  // 6. TCP Port Probe Tool
  header('6. TCP Port Probe Tool');
  try {
    const tcpHost = '1.1.1.1';
    const tcpPort = 53;
    console.log(`Probing TCP port ${tcpHost}:${tcpPort}...`);
    const tcpRes = await checkTcp(tcpHost, tcpPort, 2000);
    const tcpColor = tcpRes.ok ? colors.green : colors.red;
    console.log(`Result: ${tcpColor}${tcpRes.message}${colors.reset} (${tcpRes.latencyMs || 0} ms)`);
  } catch (err) {
    console.log(`TCP probe failed: ${err.message}`);
  }

  // 7. HTTP Endpoint Probe Tool
  header('7. HTTP/HTTPS Endpoint Probe Tool');
  try {
    const url = 'https://archidtech.in';
    console.log(`Testing HTTP GET ${url}...`);
    const httpRes = await checkHttp(url, 4000);
    const httpColor = httpRes.ok ? colors.green : colors.red;
    console.log(`Result: ${httpColor}${httpRes.message}${colors.reset} (${httpRes.latencyMs || 0} ms)`);
  } catch (err) {
    console.log(`HTTP check failed: ${err.message}`);
  }

  console.log(`\n${colors.bold}${colors.green}All tool checks completed successfully!${colors.reset}\n`);
}

main().catch((err) => {
  console.error('Error running tools exploration:', err);
  process.exit(1);
});
