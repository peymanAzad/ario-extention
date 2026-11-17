import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';

export async function startTestDaemon() {
  if (process.env.ARIO_TEST_ORIGIN) {
    return {
      origin: process.env.ARIO_TEST_ORIGIN,
      verify() {},
      async close() {},
    };
  }

  const requests = new Set();
  const health = {
    server: 'ok',
    aria2_reachable: true,
    tui_managed: false,
    download_speed: 0,
    active_downloads: 0,
  };
  const settings = {
    default_download_location: '/tmp/ario-smoke/Downloads',
    category_locations: { Video: '/tmp/ario-smoke/Downloads/Videos' },
    category_extensions: { Video: ['mp4'] },
    proxy: {
      enabled: false,
      host: null,
      port: null,
      username: null,
      password: null,
    },
    start_daemon_on_login: false,
    stop_daemon_on_close: false,
  };
  const server = createServer((request, response) => {
    requests.add(`${request.method} ${request.url}`);
    const body =
      request.url === '/health'
        ? health
        : request.url === '/settings'
          ? settings
          : null;
    if (request.method !== 'GET' || body === null) {
      response.writeHead(404).end();
      return;
    }

    // No CORS header. The request must use the extension's loopback host access.
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    verify() {
      assert.deepEqual(requests, new Set(['GET /health', 'GET /settings']));
    },
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
