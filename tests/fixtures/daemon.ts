import { http, HttpResponse } from 'msw';
import { dashboardDownloads, mainQueue, nightQueue } from './dashboard';
import { defaultDaemonOrigin } from '@/shared/api/endpoint';

export const capabilitiesUrl = `${defaultDaemonOrigin}/browser-capabilities`;
export const browserCapabilities = {
  protocol_version: 1,
  staged_handoff: true,
  http_session: true,
  daemon_timezone: 'Asia/Tbilisi',
};
export const healthUrl = `${defaultDaemonOrigin}/health`;
export const health = {
  server: 'ok',
  aria2_reachable: true,
  tui_managed: false,
  download_speed: 0,
  active_downloads: 0,
};

export const daemonSettings = {
  default_download_location: '/home/user/Downloads',
  category_locations: { Video: '/home/user/Downloads/Videos' },
  category_extensions: { Video: ['mp4'] },
  proxy: {
    enabled: true,
    host: '127.0.0.1',
    port: 8080,
    username: 'user',
    password: null,
  },
  start_daemon_on_login: false,
  stop_daemon_on_close: false,
};

export const daemonHandlers = [
  http.get(capabilitiesUrl, () => HttpResponse.json(browserCapabilities)),
  http.get(`${defaultDaemonOrigin}/downloads`, () =>
    HttpResponse.json(dashboardDownloads),
  ),
  http.get(`${defaultDaemonOrigin}/queues`, () =>
    HttpResponse.json([mainQueue, nightQueue]),
  ),
  http.get(healthUrl, () => HttpResponse.json(health)),
  http.get(`${defaultDaemonOrigin}/settings`, () =>
    HttpResponse.json(daemonSettings),
  ),
];

export const daemonOffline = http.get(healthUrl, () => HttpResponse.error());

export const aria2Offline = http.get(healthUrl, () =>
  HttpResponse.json({ ...health, aria2_reachable: false }),
);
