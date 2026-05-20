const Docker = require('dockerode');
const path   = require('path');
const fs     = require('fs');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const SERVERS_DIR = process.env.SERVERS_DIR || '/opt/kroxy/servers';

// Pull image with timeout — don't hang forever
async function pullImage(image) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('[Docker] Image pull timed out, proceeding anyway');
      resolve();
    }, 120000); // 2 min max

    docker.pull(image, (err, stream) => {
      if (err || !stream) {
        clearTimeout(timeout);
        console.log('[Docker] Pull skipped:', err?.message || 'no stream');
        return resolve();
      }
      docker.modem.followProgress(stream, (err2) => {
        clearTimeout(timeout);
        if (err2) console.log('[Docker] Pull error:', err2.message);
        resolve();
      }, (event) => {
        // progress events — log status
        if (event.status) process.stdout.write('.');
      });
    });
  });
}

// Remove existing container if name conflicts
async function removeIfExists(name) {
  try {
    const existing = docker.getContainer(name);
    const info     = await existing.inspect();
    if (info) {
      if (info.State.Running) await existing.stop().catch(() => {});
      await existing.remove({ force: true });
      console.log(`[Docker] Removed existing container: ${name}`);
    }
  } catch(e) {
    // Container doesn't exist — fine
  }
}

async function createMinecraftServer(server) {
  try {
    const serverDir = path.join(SERVERS_DIR, server._id.toString());
    fs.mkdirSync(serverDir, { recursive: true });
    fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n');

    const containerName = `kroxy_${server._id}`;

    // Remove any existing container with same name (from failed previous attempt)
    await removeIfExists(containerName);

    // Pull image (with timeout)
    console.log(`[Docker] Pulling itzg/minecraft-server...`);
    await pullImage('itzg/minecraft-server:latest');
    console.log(`\n[Docker] Image ready`);

    const serverType = server.serverType || 'VANILLA';
    const onlineMode = server.onlineMode ? 'TRUE' : 'FALSE';
    const javaFlags  = server.javaFlags  || '';

    const envVars = [
      'EULA=TRUE',
      `MEMORY=${server.ram}M`,
      `VERSION=${server.version || 'LATEST'}`,
      `TYPE=${serverType}`,
      `SERVER_NAME=${server.name}`,
      `ONLINE_MODE=${onlineMode}`,
      'ENABLE_RCON=TRUE',
      'RCON_PASSWORD=kroxypanel',
      'RCON_PORT=25575',
      'ALLOW_FLIGHT=TRUE',
      'OVERRIDE_SERVER_PROPERTIES=TRUE',
      `MAX_MEMORY=${server.ram}M`,
      `INIT_MEMORY=${Math.max(512, Math.floor(server.ram * 0.5))}M`,
    ];

    if (javaFlags) envVars.push(`JVM_OPTS=${javaFlags}`);

    const container = await docker.createContainer({
      Image: 'itzg/minecraft-server:latest',
      name:  containerName,
      Env:   envVars,
      HostConfig: {
        Memory:         server.ram * 1024 * 1024,
        MemorySwap:     server.ram * 1024 * 1024 * 2,
        CpuPercent:     server.cpu || 100,
        Binds:          [`${serverDir}:/data`],
        PortBindings: {
          '25565/tcp':  [{ HostPort: server.port.toString() }],
          '25575/tcp':  [{ HostPort: (server.port + 10).toString() }],
        },
        RestartPolicy: { Name: 'unless-stopped' },
      },
      ExposedPorts: {
        '25565/tcp': {},
        '25575/tcp': {},
      },
    });

    await container.start();
    console.log(`[Docker] Container started: ${container.id.substring(0, 12)}`);
    return { success: true, containerId: container.id };

  } catch (e) {
    console.error('[Docker] createMinecraftServer error:', e.message);
    return { success: false, error: e.message };
  }
}

async function startContainer(containerId) {
  try {
    const c = docker.getContainer(containerId);
    await c.start();
    return true;
  } catch (e) {
    console.error('[Docker] start error:', e.message);
    return false;
  }
}

async function stopContainer(containerId) {
  try {
    const c = docker.getContainer(containerId);
    await c.stop({ t: 10 });
    return true;
  } catch (e) { return false; }
}

async function restartContainer(containerId) {
  try {
    const c = docker.getContainer(containerId);
    await c.restart();
    return true;
  } catch (e) { return false; }
}

async function killContainer(containerId) {
  try {
    const c = docker.getContainer(containerId);
    await c.kill();
    return true;
  } catch(e) { return false; }
}

async function removeContainer(containerId) {
  try {
    const c = docker.getContainer(containerId);
    await c.remove({ force: true });
    return true;
  } catch (e) { return false; }
}

async function getStatus(containerId) {
  try {
    const c    = docker.getContainer(containerId);
    const info = await c.inspect();
    return info.State.Status; // 'running', 'exited', etc.
  } catch (e) { return 'unknown'; }
}

async function getStats(containerId) {
  try {
    const c     = docker.getContainer(containerId);
    const stats = await c.stats({ stream: false });

    const cpuDelta    = (stats.cpu_stats?.cpu_usage?.total_usage    || 0) - (stats.precpu_stats?.cpu_usage?.total_usage    || 0);
    const systemDelta = (stats.cpu_stats?.system_cpu_usage           || 0) - (stats.precpu_stats?.system_cpu_usage           || 0);
    const numCpus     = (stats.cpu_stats?.cpu_usage?.percpu_usage    || [1]).length;
    const cpu         = systemDelta > 0 ? parseFloat(((cpuDelta / systemDelta) * numCpus * 100).toFixed(1)) : 0;

    const memUsed  = stats.memory_stats?.usage  || 0;
    const memLimit = stats.memory_stats?.limit  || 1;
    const memCache = stats.memory_stats?.stats?.cache || 0;
    const actualMem = Math.max(0, memUsed - memCache);

    return {
      cpu,
      mem:      Math.round(actualMem / 1024 / 1024),
      memLimit: Math.round(memLimit  / 1024 / 1024),
      memPct:   parseFloat(((actualMem / memLimit) * 100).toFixed(1)),
    };
  } catch (e) {
    return { cpu: 0, mem: 0, memLimit: 0, memPct: 0 };
  }
}

async function getLogs(containerId, tail = 150) {
  try {
    const c      = docker.getContainer(containerId);
    const stream = await c.logs({ stdout: true, stderr: true, tail, timestamps: false });

    if (typeof stream === 'string') return stream;
    if (!Buffer.isBuffer(stream))   return '';

    // Strip Docker multiplexed stream 8-byte headers
    let output = '';
    let offset = 0;
    while (offset < stream.length) {
      if (offset + 8 > stream.length) break;
      const size = stream.readUInt32BE(offset + 4);
      if (size === 0) { offset += 8; continue; }
      output += stream.slice(offset + 8, offset + 8 + size).toString('utf8');
      offset += 8 + size;
    }
    return output || stream.toString('utf8');
  } catch (e) { return ''; }
}

async function sendCommand(containerId, command) {
  try {
    // Try RCON first (most reliable for MC)
    const c = docker.getContainer(containerId);
    const exec = await c.exec({
      Cmd: ['rcon-cli', '--password', 'kroxypanel', command],
      AttachStdout: true,
      AttachStderr: false,
    });
    await exec.start({ Detach: true });
    return true;
  } catch (e) {
    try {
      // Fallback: mc-send-to-console
      const c = docker.getContainer(containerId);
      const exec = await c.exec({
        Cmd: ['mc-send-to-console', command],
        AttachStdout: false,
      });
      await exec.start({ Detach: true });
      return true;
    } catch (e2) {
      return false;
    }
  }
}

module.exports = {
  createMinecraftServer,
  startContainer,
  stopContainer,
  restartContainer,
  killContainer,
  removeContainer,
  getStatus,
  getStats,
  getLogs,
  sendCommand,
};
