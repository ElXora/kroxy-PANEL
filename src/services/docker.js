const Docker = require('dockerode');
const path = require('path');
const fs = require('fs');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const SERVERS_DIR = process.env.SERVERS_DIR || '/opt/kryoxi/servers';

async function createMinecraftServer(server) {
  try {
    const serverDir = path.join(SERVERS_DIR, server._id.toString());
    fs.mkdirSync(serverDir, { recursive: true });
    fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n');

    // Pull image if needed
    await new Promise((resolve) => {
      docker.pull('itzg/minecraft-server:latest', (err, stream) => {
        if (err || !stream) return resolve();
        docker.modem.followProgress(stream, resolve);
      });
    });

    const container = await docker.createContainer({
      Image: 'itzg/minecraft-server:latest',
      name: `kroxy_${server._id}`,
      Env: [
        'EULA=TRUE',
        `MEMORY=${server.ram}M`,
        `VERSION=${server.version || 'LATEST'}`,
        'TYPE=VANILLA',
        `SERVER_NAME=${server.name}`,
        'ONLINE_MODE=FALSE',
      ],
      HostConfig: {
        Memory: server.ram * 1024 * 1024,
        Binds: [`${serverDir}:/data`],
        PortBindings: {
          '25565/tcp': [{ HostPort: server.port.toString() }]
        },
        RestartPolicy: { Name: 'unless-stopped' },
      },
      ExposedPorts: { '25565/tcp': {} },
    });

    await container.start();
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
    await c.stop();
    return true;
  } catch (e) {
    return false;
  }
}

async function restartContainer(containerId) {
  try {
    const c = docker.getContainer(containerId);
    await c.restart();
    return true;
  } catch (e) {
    return false;
  }
}

async function removeContainer(containerId) {
  try {
    const c = docker.getContainer(containerId);
    await c.remove({ force: true });
    return true;
  } catch (e) {
    return false;
  }
}

async function getStatus(containerId) {
  try {
    const c = docker.getContainer(containerId);
    const info = await c.inspect();
    return info.State.Status; // 'running', 'exited', etc.
  } catch (e) {
    return 'unknown';
  }
}

async function getStats(containerId) {
  try {
    const c = docker.getContainer(containerId);
    const stats = await c.stats({ stream: false });

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = (stats.cpu_stats.cpu_usage.percpu_usage || [1]).length;
    const cpu = systemDelta > 0 ? ((cpuDelta / systemDelta) * numCpus * 100).toFixed(1) : '0.0';

    const memUsed = stats.memory_stats.usage || 0;
    const memLimit = stats.memory_stats.limit || 1;

    return {
      cpu: parseFloat(cpu),
      mem: Math.round(memUsed / 1024 / 1024),
      memLimit: Math.round(memLimit / 1024 / 1024),
      memPct: ((memUsed / memLimit) * 100).toFixed(1),
    };
  } catch (e) {
    return { cpu: 0, mem: 0, memLimit: 0, memPct: 0 };
  }
}

async function getLogs(containerId, tail = 150) {
  try {
    const c = docker.getContainer(containerId);
    const stream = await c.logs({ stdout: true, stderr: true, tail, timestamps: false });
    // Strip multiplexed stream headers
    let output = '';
    let offset = 0;
    while (offset < stream.length) {
      if (offset + 8 > stream.length) break;
      const size = stream.readUInt32BE(offset + 4);
      output += stream.slice(offset + 8, offset + 8 + size).toString('utf8');
      offset += 8 + size;
    }
    return output || stream.toString('utf8');
  } catch (e) {
    return '';
  }
}

async function sendCommand(containerId, command) {
  try {
    const c = docker.getContainer(containerId);
    const exec = await c.exec({
      Cmd: ['mc-send-to-console', command],
      AttachStdout: true,
      AttachStderr: true,
    });
    await exec.start({ Detach: true });
    return true;
  } catch (e) {
    // Fallback: try rcon-cli
    try {
      const c = docker.getContainer(containerId);
      const exec = await c.exec({
        Cmd: ['rcon-cli', command],
        AttachStdout: true,
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
  removeContainer,
  getStatus,
  getStats,
  getLogs,
  sendCommand,
};
