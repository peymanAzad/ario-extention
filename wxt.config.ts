import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { loopbackHostPermissions } from './src/shared/api/endpoint';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  zip: { zipSources: false },
  manifest: ({ browser }) => ({
    name: 'Ario',
    description: 'Manage downloads with the local Ario daemon.',
    permissions: ['storage'],
    host_permissions: [...loopbackHostPermissions],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'ario-extension@ario.local',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
