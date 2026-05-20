const docker  = require('./docker');
const db      = require('../db');

module.exports = function setupWebSocket(wss) {
  wss.on('connection', async (ws, req) => {
    const url      = new URL(req.url, 'http://localhost');
    const serverId = url.searchParams.get('serverId');
    const token    = url.searchParams.get('token');  // session-based token

    if (!serverId || !token) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing auth' }));
      ws.close(1008, 'Missing params');
      return;
    }

    // Find session by token stored on user
    const user = await db.users.findOne({ wsToken: token }).catch(() => null);
    if (!user) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid auth token' }));
      ws.close(1008, 'Unauthorized');
      return;
    }

    const server = await db.servers.findOne({ _id: serverId, userId: user._id }).catch(() => null);
    if (!server) {
      ws.send(JSON.stringify({ type: 'error', message: 'Server not found' }));
      ws.close();
      return;
    }

    if (!server.containerId) {
      ws.send(JSON.stringify({ type: 'log', data: '[Kroxy] Container is still being created. Please wait...\n' }));
      // Poll until container is ready
      let attempts = 0;
      const waitInterval = setInterval(async () => {
        attempts++;
        const fresh = await db.servers.findOne({ _id: serverId }).catch(() => null);
        if (fresh && fresh.containerId) {
          clearInterval(waitInterval);
          startStreaming(ws, fresh);
        } else if (attempts > 30) {
          clearInterval(waitInterval);
          ws.send(JSON.stringify({ type: 'error', message: 'Container creation timed out' }));
          ws.close();
        }
      }, 3000);
      ws.on('close', () => clearInterval(waitInterval));
      return;
    }

    startStreaming(ws, server);
  });
};

async function startStreaming(ws, server) {
  ws.send(JSON.stringify({ type: 'status', message: 'connected' }));

  // Send initial logs
  try {
    const logs = await docker.getLogs(server.containerId, 100);
    if (logs) ws.send(JSON.stringify({ type: 'log', data: logs }));
  } catch(e) {}

  let lastLogLen = 0;
  const interval = setInterval(async () => {
    if (ws.readyState !== 1) { clearInterval(interval); return; }
    try {
      const logs = await docker.getLogs(server.containerId, 50);
      if (logs && logs.length > lastLogLen) {
        const diff = logs.slice(lastLogLen);
        if (diff.trim()) ws.send(JSON.stringify({ type: 'log', data: diff }));
        lastLogLen = logs.length;
      }
    } catch(e) {}
  }, 2000);

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'command' && data.command) {
        await docker.sendCommand(server.containerId, data.command.trim());
        ws.send(JSON.stringify({ type: 'log', data: `> ${data.command}\n` }));
      }
    } catch(e) {}
  });

  ws.on('close', () => clearInterval(interval));
}
