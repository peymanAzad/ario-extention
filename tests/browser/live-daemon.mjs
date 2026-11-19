import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitFor(check, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

async function reservePort() {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  return {
    port: socket.address().port,
    release: () =>
      new Promise((resolve, reject) =>
        socket.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

export async function startLiveDaemon(binary) {
  assert.equal(
    process.platform,
    'linux',
    'The isolated daemon runner requires Linux.',
  );
  const root = await mkdtemp(join(tmpdir(), 'ario-release-daemon-'));
  const config = join(root, 'ario');
  let child;
  let exited;
  let output = '';
  const close = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const stopped = await Promise.race([
        exited.then(() => true),
        delay(5000, false, { ref: false }),
      ]);
      if (!stopped) {
        child.kill('SIGKILL');
        await exited;
      }
    }
    await rm(root, { recursive: true, force: true });
  };

  try {
    await mkdir(config);
    const api = await reservePort();
    const rpc = await reservePort();
    await Promise.all([api.release(), rpc.release()]);
    await writeFile(
      join(config, 'server.toml'),
      `[settings]
default_download_location = ${JSON.stringify(join(root, 'downloads'))}
start_daemon_on_login = false
stop_daemon_on_close = false

[settings.category_locations]

[settings.category_extensions]

[aria2]
binary_path = "aria2c"
rpc_port = ${rpc.port}
download_dir = ${JSON.stringify(join(root, 'downloads'))}
`,
    );
    child = spawn(binary, ['--port', String(api.port)], {
      env: { ...process.env, XDG_CONFIG_HOME: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    exited = new Promise((resolve) => {
      child.once('exit', resolve);
      child.once('error', (error) => {
        output += error.message;
        resolve();
      });
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const match = await waitFor(
      () => /ario is running on (http:\/\/127\.0\.0\.1:\d+)/.exec(output),
      'the isolated daemon to listen',
    );
    const [, origin] = match;
    const request = (route) =>
      globalThis.fetch(`${origin}${route}`, {
        signal: globalThis.AbortSignal.timeout(3000),
      });
    const read = async (route) => {
      const response = await request(route);
      assert.equal(response.status, 200, route);
      return response.json();
    };
    await waitFor(async () => (await read('/health')).aria2_reachable, 'aria2');
    const capabilities = await request('/browser-capabilities');
    assert.ok([200, 404].includes(capabilities.status));
    const handoff = capabilities.ok;
    if (handoff) {
      const body = await capabilities.json();
      assert.equal(body.protocol_version, 1);
      assert.equal(body.staged_handoff, true);
    }
    return {
      origin,
      handoff,
      live: true,
      read,
      close,
    };
  } catch (error) {
    await close();
    throw new Error(`${error.message}\n${output}`, { cause: error });
  }
}
