import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native wrapper for iOS / Android. Build web assets first (`npm run build`), then
 * `npx cap add ios|android` once, and `npm run cap:sync` after every change.
 * Set VITE_SERVER_URL (e.g. wss://play.moonbite.gg/ws) at build time for online play.
 */
const config: CapacitorConfig = {
  appId: 'gg.moonbite.app',
  appName: 'Moonbite',
  webDir: 'dist',
  backgroundColor: '#120B1F',
  ios: {
    contentInset: 'never',
    backgroundColor: '#120B1F',
  },
  android: {
    backgroundColor: '#120B1F',
  },
};

export default config;
