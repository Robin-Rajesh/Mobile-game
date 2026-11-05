import '@fontsource/lilita-one/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './styles.css';
import { Game } from './game/Game';
import { ProfileStore } from './meta/profile';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;

  // Wait (briefly) for the display font so canvas text never flashes a fallback.
  try {
    await Promise.race([document.fonts.load('32px "Lilita One"'), new Promise((r) => setTimeout(r, 1500))]);
    await document.fonts.load('600 16px "Fredoka"');
  } catch {
    /* fonts are cosmetic */
  }

  const profile = new ProfileStore();
  const game = new Game(canvas, ui, profile);
  game.start();
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __mb: Game }).__mb = game;

  if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }

  // block pinch-zoom / double-tap zoom on iOS Safari
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

void boot();
