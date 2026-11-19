import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { loopbackHostPermissions } from './src/shared/api/endpoint';

export default defineConfig({
  srcDir: 'src',
  publicDir: 'src/public',
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  zip: {
    sourcesTemplate: '{{name}}-{{version}}-{{browser}}-sources.zip',
    includeSources: [
      'src/**',
      'README.md',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.json',
      'wxt.config.ts',
      '.nvmrc',
    ],
    dotSources: true,
  },
  manifest: ({ browser }) => ({
    name: 'Ario',
    description: 'Manage downloads with the local Ario daemon.',
    action: { default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' } },
    permissions: ['storage', 'contextMenus', 'alarms'],
    host_permissions: [...loopbackHostPermissions],
    optional_permissions: ['cookies', 'downloads', 'webRequest'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    incognito: 'not_allowed',
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'",
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'ario-extension@ario.local',
          strict_min_version: '140.0',
          data_collection_permissions: {
            required: ['browsingActivity', 'websiteActivity', 'websiteContent'],
          },
        },
      },
    }),
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  hooks: {
    'vite:build:extendConfig': (entrypoints, config) => {
      const background = entrypoints.some(({ type }) => type === 'background');
      (config.build ??= {}).license = {
        fileName: background ? 'LICENSE-background.txt' : 'LICENSE-ui.txt',
      };
    },
  },
});
