import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const candidates = Object.entries(networkInterfaces())
  .filter(([name]) => /^(en\d+|eth\d+|wlan\d+|wl\w+|enp\w+|ens\w+|Ethernet.*|Wi-Fi.*)$/i.test(name))
  .flatMap(([, addresses]) => addresses ?? [])
  .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
const addresses = [...new Set(candidates.map((a) => a.address))];
// An explicit override handles multiple NICs, VPNs and nonstandard interface names.
const ip = process.env.LIVEKIT_NODE_IP || (addresses.length === 1 ? addresses[0] : undefined);
if (!ip || !isIPv4(ip) || /^(127\.|0\.)/.test(ip)) {
  console.error('Choose the LAN IPv4 reachable from your browser, then run:');
  console.error('LIVEKIT_NODE_IP=<your-LAN-IP> npm run docker:up');
  if (addresses.length) console.error(`Detected addresses: ${addresses.join(', ')}`);
  process.exit(1);
}

// Preserve the rest of the local configuration, including credentials.
let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const setting = `LIVEKIT_NODE_IP=${ip}`;
env = /^LIVEKIT_NODE_IP=.*$/m.test(env)
  ? env.replace(/^LIVEKIT_NODE_IP=.*$/gm, setting)
  : `${env}${env.endsWith('\n') || !env ? '' : '\n'}${setting}\n`;
writeFileSync(envPath, env, { mode: 0o600 });
console.log(`Local LiveKit media address: ${ip}`);

if (!process.argv.includes('--configure-only')) {
  const result = spawnSync('docker', ['compose', 'up', '-d', '--build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, LIVEKIT_NODE_IP: ip },
  });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
