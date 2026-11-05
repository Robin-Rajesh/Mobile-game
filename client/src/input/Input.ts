import { IS_TOUCH } from '../config';

/**
 * Touch: left thumb = floating joystick anywhere on the steering half; right thumb = hold
 * anywhere on the other half to SURGE (huge hit area — you never miss it mid-fight).
 * Desktop: aim with the mouse, hold click / Space to surge. Keyboard steering also works.
 */
export class Input {
  angle = 0;
  surge = false;
  /** Has the player steered at all (tutorial uses this). */
  steered = false;
  surgedOnce = false;
  enabled = false;
  leftHanded = false;

  private stickId: number | null = null;
  private surgeId: number | null = null;
  private baseX = 0;
  private baseY = 0;
  private mouseX = 0;
  private mouseY = 0;
  private mouseActive = false;
  private mouseDown = false;
  private keys = new Set<string>();
  private originX = 0;
  private originY = 0;

  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  readonly surgeBtn: HTMLDivElement;
  private surgeFill: HTMLDivElement;

  constructor(private canvas: HTMLCanvasElement, layer: HTMLElement) {
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'stick-base';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'stick-knob';
    this.stickBase.appendChild(this.stickKnob);
    this.surgeBtn = document.createElement('div');
    this.surgeBtn.className = 'surge-btn';
    this.surgeBtn.innerHTML = '<div class="surge-fill"></div><span>SURGE</span>';
    this.surgeFill = this.surgeBtn.querySelector('.surge-fill') as HTMLDivElement;
    layer.append(this.stickBase, this.surgeBtn);
    this.setVisible(false);

    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', () => this.reset());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setVisible(v: boolean): void {
    this.surgeBtn.style.display = v && IS_TOUCH ? '' : 'none';
    if (!v) this.stickBase.style.display = 'none';
    this.surgeBtn.classList.toggle('left', this.leftHanded);
  }

  /** Screen position of our core — mouse aim is relative to it. */
  setOrigin(x: number, y: number): void {
    this.originX = x;
    this.originY = y;
  }

  /** 0..1 how "charged" surge is (UI shows the mass cost). */
  setSurgeAvailable(ok: boolean): void {
    this.surgeBtn.classList.toggle('disabled', !ok);
  }

  setSurgeMeter(fraction: number): void {
    this.surgeFill.style.transform = `scaleY(${Math.max(0, Math.min(1, fraction))})`;
  }

  reset(): void {
    this.stickId = null;
    this.surgeId = null;
    this.surge = false;
    this.mouseDown = false;
    this.keys.clear();
    this.stickBase.style.display = 'none';
    this.surgeBtn.classList.remove('active');
  }

  private isSurgeSide(x: number): boolean {
    const w = window.innerWidth;
    return this.leftHanded ? x < w * 0.45 : x > w * 0.55;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      this.mouseActive = true;
      this.mouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.updateMouseAngle();
      this.refreshSurge();
      return;
    }
    e.preventDefault();
    if (this.isSurgeSide(e.clientX) && this.surgeId === null) {
      this.surgeId = e.pointerId;
      this.refreshSurge();
    } else if (this.stickId === null) {
      this.stickId = e.pointerId;
      this.baseX = e.clientX;
      this.baseY = e.clientY;
      this.stickBase.style.display = 'block';
      this.stickBase.style.transform = `translate(${this.baseX}px, ${this.baseY}px)`;
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.mouseActive = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.enabled) this.updateMouseAngle();
      return;
    }
    if (e.pointerId !== this.stickId) return;
    let dx = e.clientX - this.baseX;
    let dy = e.clientY - this.baseY;
    const len = Math.hypot(dx, dy);
    const max = 56;
    if (len > 10) {
      this.angle = Math.atan2(dy, dx);
      this.steered = true;
    }
    // drag the base along when the thumb wanders far — feels like a real stick
    if (len > max * 1.6) {
      const k = (len - max * 1.6) / len;
      this.baseX += dx * k;
      this.baseY += dy * k;
      this.stickBase.style.transform = `translate(${this.baseX}px, ${this.baseY}px)`;
      dx = e.clientX - this.baseX;
      dy = e.clientY - this.baseY;
    }
    const l = Math.hypot(dx, dy);
    const s = l > max ? max / l : 1;
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx * s}px), calc(-50% + ${dy * s}px))`;
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.mouseDown = false;
      this.refreshSurge();
      return;
    }
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickBase.style.display = 'none';
    }
    if (e.pointerId === this.surgeId) {
      this.surgeId = null;
      this.refreshSurge();
    }
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    const tracked = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift'];
    if (!tracked.includes(k)) return;
    e.preventDefault();
    if (e.type === 'keydown') this.keys.add(k);
    else this.keys.delete(k);
    const x = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    const y = (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0) - (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0);
    if (x || y) {
      this.angle = Math.atan2(y, x);
      this.steered = true;
      this.mouseActive = false;
    }
    this.refreshSurge();
  };

  private updateMouseAngle(): void {
    const dx = this.mouseX - this.originX;
    const dy = this.mouseY - this.originY;
    if (dx * dx + dy * dy > 64) {
      this.angle = Math.atan2(dy, dx);
      this.steered = true;
    }
  }

  private refreshSurge(): void {
    const was = this.surge;
    this.surge = this.surgeId !== null || this.mouseDown || this.keys.has(' ') || this.keys.has('shift');
    if (this.surge && !was) this.surgedOnce = true;
    this.surgeBtn.classList.toggle('active', this.surge);
  }

  /** Called every frame so mouse aim tracks a moving camera. */
  update(): void {
    if (this.mouseActive && this.enabled) this.updateMouseAngle();
  }

  get canvasEl(): HTMLCanvasElement {
    return this.canvas;
  }
}
