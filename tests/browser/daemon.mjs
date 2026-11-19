import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { smokeMagnet } from './confirmation.mjs';

export async function startTestDaemon() {
  if (process.env.ARIO_TEST_ORIGIN) {
    return {
      origin: process.env.ARIO_TEST_ORIGIN,
      verify() {},
      async close() {},
    };
  }

  const requests = new Set();
  const counts = new Map();
  const handoffs = new Map();
  let offline = false;
  let large = false;
  const health = {
    server: 'ok',
    aria2_reachable: true,
    tui_managed: false,
    download_speed: 524288,
    active_downloads: 2,
    proxy_reachable: true,
    proxy_data: true,
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
  const queue = {
    id: 1,
    name: 'Main Queue',
    position: 0,
    status: 'Active',
    settings: {
      max_concurrent_downloads: 2,
      max_retries: 3,
      default_finetune: {},
    },
    scheduler: {
      enabled: false,
      run_missed_on_startup: false,
      recurrence: {
        Once: { start: '2026-11-19T00:00:00Z', end: '2026-11-20T00:00:00Z' },
      },
    },
    created_at: '2026-11-19T00:00:00Z',
  };
  const nightQueue = {
    ...queue,
    id: 2,
    name: 'Night shift',
    position: 1,
    status: 'Paused',
  };
  const statuses = [
    'Active',
    'Paused',
    'Completed',
    'Pending',
    { Error: 'Fixture server refused connection' },
    'Removed',
    'Active',
  ];
  const names = [
    'Movie.mp4',
    'Song.flac',
    'Report.pdf',
    'Backup.zip',
    'Installer.bin',
    'Removed.bin',
    null,
  ];
  const categories = [
    'Video',
    'Music',
    'Document',
    'Archive',
    'Program',
    'Other',
    'Other',
  ];
  function download(index) {
    return {
      download: {
        id: index + 1,
        aria2_gid: null,
        url:
          index === 6
            ? 'magnet:?xt=urn:btih:fixture'
            : `https://example.test/file-${index + 1}`,
        filename: large ? `File-${index + 1}.bin` : names[index],
        destination_path: '/tmp/ario-smoke/Downloads',
        source_type: index === 6 ? 'Magnet' : 'Http',
        category: categories[index % 7],
        status: statuses[index % 7],
        paused_by_scheduler: false,
        manually_started: false,
        size: index === 6 ? null : 1048576,
        completed_length: 524288,
        queue_id: [3, 4].includes(index) ? 2 : 1,
        position_in_queue: index,
        finetune: {},
        created_at: '2026-11-19T00:00:00Z',
        started_at: null,
        completed_at: null,
      },
      completed_length: 524288,
      download_speed: index % 7 === 0 ? 524288 : 0,
      eta_seconds: index % 7 === 0 ? 1 : null,
    };
  }
  const json = (response, body) =>
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(body));
  const server = createServer(async (request, response) => {
    if (request.url === '/favicon.ico') return response.writeHead(204).end();
    if (request.url === '/browser-handoff-fixture') {
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': [
          'ario_fixture=allowed; Path=/private; HttpOnly; SameSite=Strict',
          'ario_other=excluded; Path=/other; HttpOnly; SameSite=Strict',
        ],
      });
      response.end(
        `<a id="magnet-link" href="${smokeMagnet.replaceAll('&', '&amp;')}">Fixture torrent</a>
        <a id="private-link" href="/private/credentialed.zip">Credentialed file</a>`,
      );
      return;
    }
    if (request.url === '/browser-handoffs' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { id, request: payload } = JSON.parse(body);
      if (!handoffs.has(id)) handoffs.set(id, { payload, state: 'staged' });
      json(response, { id, state: 'staged', download_id: null });
      return;
    }
    const commit = /^\/browser-handoffs\/([\da-f-]+)\/commit$/.exec(
      request.url,
    );
    if (commit && request.method === 'POST') {
      const id = commit[1];
      const handoff = handoffs.get(id);
      if (!handoff) return response.writeHead(404).end();
      handoff.state = 'committed';
      json(response, { id, state: 'committed', download_id: 42 });
      return;
    }
    requests.add(`${request.method} ${request.url}`);
    counts.set(request.url, (counts.get(request.url) ?? 0) + 1);
    if (offline) {
      response.writeHead(503, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          result: 'error',
          message: 'Fixture daemon unavailable',
        }),
      );
      return;
    }
    const body = {
      '/health': health,
      '/settings': settings,
      '/browser-capabilities': {
        protocol_version: 1,
        staged_handoff: true,
        http_session: true,
        daemon_timezone: 'Asia/Tbilisi',
      },
      '/downloads': Array.from({ length: large ? 10000 : 7 }, (_, index) =>
        download(index),
      ),
      '/queues': [queue, nightQueue],
      '/queues/2': nightQueue,
    }[request.url];
    if (request.method !== 'GET' || body === undefined) {
      response.writeHead(404).end();
      return;
    }
    // No CORS header. The request must use the extension's loopback host access.
    json(response, body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    fixture: true,
    setOffline(value) {
      offline = value;
    },
    setLarge(value) {
      large = value;
    },
    downloadRequests() {
      return counts.get('/downloads') ?? 0;
    },
    verifyHandoffs(...payloads) {
      assert.deepEqual(
        [...handoffs.values()],
        payloads.map((payload) => ({ payload, state: 'committed' })),
      );
    },
    verify() {
      assert.deepEqual(
        requests,
        new Set([
          'GET /health',
          'GET /settings',
          'GET /browser-capabilities',
          'GET /downloads',
          'GET /queues',
          'GET /queues/2',
        ]),
      );
    },
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
