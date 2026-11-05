import { Capacitor } from '@capacitor/core';

/** Where to find the multiplayer server. Empty string disables online play. */
export function serverUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env !== undefined) return env;
  if (Capacitor.isNativePlatform()) return ''; // native builds must be configured explicitly
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export const IS_TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
export const IS_NATIVE = Capacitor.isNativePlatform();
export const BUILD_VERSION = __APP_VERSION__;

declare global {
  const __APP_VERSION__: string;
}
