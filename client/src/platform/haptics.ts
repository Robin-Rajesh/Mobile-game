import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { IS_NATIVE } from '../config';

export type HapticKind = 'tick' | 'light' | 'medium' | 'heavy' | 'success' | 'fail';

let enabled = true;
let lastAt = 0;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

const WEB_PATTERNS: Record<HapticKind, number | number[]> = {
  tick: 6,
  light: 12,
  medium: 22,
  heavy: [30, 30, 50],
  success: [15, 40, 25],
  fail: [60, 40, 90],
};

export function haptic(kind: HapticKind): void {
  if (!enabled) return;
  const now = performance.now();
  // never buzz more than ~20x/s — phones turn it into mush
  if (kind === 'tick' && now - lastAt < 50) return;
  lastAt = now;
  if (IS_NATIVE) {
    switch (kind) {
      case 'tick':
        void Haptics.selectionChanged();
        break;
      case 'light':
        void Haptics.impact({ style: ImpactStyle.Light });
        break;
      case 'medium':
        void Haptics.impact({ style: ImpactStyle.Medium });
        break;
      case 'heavy':
        void Haptics.impact({ style: ImpactStyle.Heavy });
        break;
      case 'success':
        void Haptics.notification({ type: NotificationType.Success });
        break;
      case 'fail':
        void Haptics.notification({ type: NotificationType.Error });
        break;
    }
    return;
  }
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(WEB_PATTERNS[kind]);
    } catch {
      /* some browsers throw without user activation */
    }
  }
}
