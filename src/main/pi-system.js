const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCommand } = require('./checks');

/**
 * Read the Raspberry Pi model name from device tree or cpuinfo.
 */
function getPiModel() {
  try {
    if (fs.existsSync('/proc/device-tree/model')) {
      const model = fs.readFileSync('/proc/device-tree/model', 'utf8').trim().replace(/\0/g, '');
      if (model) return model;
    }
  } catch {}

  try {
    if (fs.existsSync('/proc/cpuinfo')) {
      const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
      const match = cpuinfo.match(/^Model\s*:\s*(.+)$/im);
      if (match?.[1]) return match[1].trim();
    }
  } catch {}

  return `${os.type()} ${os.arch()} (${os.release()})`;
}

/**
 * Read SoC CPU temperature on Linux/Raspberry Pi.
 * Tries /sys/class/thermal/thermal_zone0/temp first (standard Linux/Pi sysfs),
 * then falls back to vcgencmd measure_temp.
 */
async function getCpuTemperature() {
  try {
    if (fs.existsSync('/sys/class/thermal/thermal_zone0/temp')) {
      const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
      const millidegrees = Number.parseInt(raw, 10);
      if (!Number.isNaN(millidegrees)) {
        return Math.round((millidegrees / 1000) * 10) / 10; // e.g. 48.5 °C
      }
    }
  } catch {}

  try {
    const result = await runCommand('vcgencmd', ['measure_temp'], 1500);
    if (result.exitCode === 0 && result.stdout) {
      const match = result.stdout.match(/temp=([0-9.]+)/i);
      if (match?.[1]) {
        return Number.parseFloat(match[1]);
      }
    }
  } catch {}

  return null;
}

/**
 * Check Raspberry Pi throttling and undervoltage status using vcgencmd get_throttled.
 */
async function getThrottledStatus() {
  try {
    const result = await runCommand('vcgencmd', ['get_throttled'], 1500);
    if (result.exitCode === 0 && result.stdout) {
      const match = result.stdout.match(/throttled=(0x[0-9a-fA-F]+)/);
      if (match?.[1]) {
        const hex = Number.parseInt(match[1], 16);
        const issues = [];
        if (hex & 0x1) issues.push('Under-voltage detected');
        if (hex & 0x2) issues.push('Arm frequency capped');
        if (hex & 0x4) issues.push('Currently throttled');
        if (hex & 0x8) issues.push('Soft temperature limit active');
        if (hex & 0x10000) issues.push('Under-voltage has occurred');
        if (hex & 0x20000) issues.push('Arm frequency capping has occurred');
        if (hex & 0x40000) issues.push('Throttling has occurred');
        if (hex & 0x80000) issues.push('Soft temperature limit has occurred');

        return {
          code: match[1],
          healthy: (hex & 0xf) === 0,
          activeIssues: issues.filter((_, i) => i < 4),
          historicalIssues: issues.filter((_, i) => i >= 4)
        };
      }
    }
  } catch {}

  return { code: '0x0', healthy: true, activeIssues: [], historicalIssues: [] };
}

/**
 * List all non-internal IPv4 and IPv6 network interfaces.
 */
function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.internal) continue;
      addresses.push({
        interface: name,
        family: iface.family,
        address: iface.address,
        mac: iface.mac
      });
    }
  }
  return addresses;
}

/**
 * Gather complete Raspberry Pi system diagnostics.
 */
async function getRaspberryPiDiagnostics() {
  const [temperature, throttled] = await Promise.all([
    getCpuTemperature(),
    getThrottledStatus()
  ]);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    model: getPiModel(),
    isRaspberryPi: fs.existsSync('/proc/device-tree/model') || fs.existsSync('/sys/firmware/devicetree/base/model'),
    cpuTemperature: temperature,
    throttled,
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usedPercent: Math.round((usedMem / totalMem) * 100)
    },
    uptimeSeconds: Math.floor(os.uptime()),
    loadAvg: os.loadavg().map((val) => Math.round(val * 100) / 100),
    cpuCount: os.cpus().length,
    addresses: getLocalNetworkAddresses(),
    hostname: os.hostname()
  };
}

module.exports = {
  getPiModel,
  getCpuTemperature,
  getThrottledStatus,
  getLocalNetworkAddresses,
  getRaspberryPiDiagnostics
};
