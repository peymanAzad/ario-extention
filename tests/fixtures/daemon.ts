import { http, HttpResponse } from 'msw';

const healthUrl = 'http://127.0.0.1:47812/health';
const health = {
  server: 'ok',
  aria2_reachable: true,
  tui_managed: false,
  download_speed: 0,
  active_downloads: 0,
};

export const daemonHandlers = [
  http.get(healthUrl, () => HttpResponse.json(health)),
];

export const daemonOffline = http.get(healthUrl, () => HttpResponse.error());

export const aria2Offline = http.get(healthUrl, () =>
  HttpResponse.json({ ...health, aria2_reachable: false }),
);
