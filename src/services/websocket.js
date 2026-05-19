const docker = require('./docker');
const db = require('../db');

module.exports = function setupWebSocket(wss) {
  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const serverId = url.searchParams.get('serverId');
    const sessionUserId = url.searchParams.get('userId');

    if (!serverId || !sessionUserId) {
      ws.close(1008, 'Missing params');
      return;
    }

    const server = await db.servers.findOne({ _id: serverId, userId: sessionUserId }).catch(() => null);
    if (!server?.containerId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Server not found or container not ready' }));
      ws.close();
      return;
    }

    ws.send(JSON.stringify({ type: 'status', message: 'Connected to console' }));

    // Stream logs initially
    const logs = await docker.getLogs(server.containerId, 80);
    if (logs) ws.send(JSON.stringify({ type: 'log', data: logs }));

    // Poll logs every 2 seconds
    let lastLog = '';
    const interval = setInterval(async () => {
      if (ws.readyState !== 1) return clearInterval(interval);
      try {
        const newLogs = await docker.getLogs(server.containerId, 30);
        if (newLogs && newLogs !== lastLog) {
          const diff = newLogs.slice(lastLog.length);
          if (diff.trim()) ws.send(JSON.stringify({ type: 'log', data: diff }));
          lastLog = newLogs;
        }
      } catch (e) {}
    }, 2000);

    ws.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'command' && data.command) {
          await docker.sendCommand(server.containerId, data.command.trim());
          ws.send(JSON.stringify({ type: 'log', data: `> ${data.command}\n` }));
        }
      } catch (e) {}
    });

    ws.on('close', () => clearInterval(interval));
  });
};
