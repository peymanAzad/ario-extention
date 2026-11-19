import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { clearInterval, setInterval } from 'node:timers';
import { URL } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { smokeMagnet } from './confirmation.mjs';
import { startLiveDaemon } from './live-daemon.mjs';

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
  let progress = 524288;
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
      completed_length: index === 0 ? progress : 524288,
      download_speed: index % 7 === 0 ? 524288 : 0,
      eta_seconds: index % 7 === 0 ? 1 : null,
    };
  }
  const json = (response, body) =>
    response
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(body));
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/capture-fixture') {
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie':
          'capture_session=fixture; Path=/capture-files/cookie; HttpOnly; SameSite=Strict',
      });
      response.end(`<a id="capture-keep" href="/capture-files/keep">Keep test</a>
        <a id="capture-ask" href="/capture-files/ask">Ask test</a>
        <a id="capture-close" href="/capture-files/close">Close test</a>
        <a id="capture-revoke" href="/capture-files/revoke">Revoke test</a>
        <a id="capture-live" href="/capture-files/live">Live handoff test</a>
        <a id="capture-automatic" href="/capture-go">Automatic test</a>
        <form method="POST" action="/capture-files/post"><button id="capture-post">POST test</button></form>`);
      return;
    }
    if (url.pathname === '/capture-go') {
      return response
        .writeHead(302, {
          Location: '/capture-files/cookie?signature=x%2Fz%2B',
        })
        .end();
    }
    if (url.pathname.startsWith('/capture-files/')) {
      const name = url.pathname.split('/').at(-1);
      const size = 96 * 1024;
      const start = Number(
        /^bytes=(\d+)-/.exec(request.headers.range)?.[1] ?? 0,
      );
      response.writeHead(start ? 206 : 200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="capture-${name}.bin"`,
        'Content-Length': size - start,
        'Accept-Ranges': 'bytes',
        ETag: '"ario-capture-fixture"',
        ...(start && { 'Content-Range': `bytes ${start}-${size - 1}/${size}` }),
      });
      let sent = start;
      function writeChunk() {
        const bytes = Math.min(1024, size - sent);
        sent += bytes;
        response.write(Buffer.alloc(bytes));
        if (sent === size) response.end();
      }
      writeChunk();
      const timer = setInterval(writeChunk, 35);
      response.on('close', () => clearInterval(timer));
      return;
    }
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
        <a id="private-link" href="/private/credentialed.zip">Credentialed file</a>
        <a id="live-link" href="/capture-files/context-menu">Live context-menu test</a>`,
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
    const handoffPath =
      /^\/browser-handoffs\/([\da-f-]+)(?:\/(commit|abort))?$/.exec(
        request.url,
      );
    if (handoffPath) {
      const [, id, action] = handoffPath;
      const handoff = handoffs.get(id);
      if (!handoff) return response.writeHead(404).end();
      if (
        (action === 'commit' && handoff.state === 'aborted') ||
        (action === 'abort' && handoff.state === 'committed')
      )
        return response.writeHead(409).end();
      if (action === 'commit') handoff.state = 'committed';
      if (action === 'abort') handoff.state = 'aborted';
      json(response, {
        id,
        state: handoff.state,
        download_id: handoff.state === 'committed' ? 42 : null,
      });
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

  const origin = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  if (process.env.ARIO_DAEMON_BIN) {
    try {
      const live = await startLiveDaemon(process.env.ARIO_DAEMON_BIN);
      return {
        ...live,
        sourceOrigin: origin,
        verify() {},
        async close() {
          await Promise.all([live.close(), close()]);
        },
      };
    } catch (error) {
      await close();
      throw error;
    }
  }

  return {
    origin,
    fixture: true,
    setOffline(value) {
      offline = value;
    },
    setLarge(value) {
      large = value;
    },
    setProgress(percent) {
      progress = Math.ceil((percent * 1048576) / 100);
    },
    downloadRequests() {
      return counts.get('/downloads') ?? 0;
    },
    captureHandoffs() {
      return [...handoffs.values()].filter(({ payload }) =>
        payload.url.includes('/capture-files/'),
      );
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
    close,
  };
}
