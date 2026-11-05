import { SURGE_MIN_MASS, SURGE_ORBIT_MULT, coreRadius } from '../../../shared/constants';
import { clamp } from '../../../shared/math';
import { skinById } from '../../../shared/skins';
import type { GameEvent } from '../../../shared/world';
import { audio } from '../audio/Audio';
import { IS_TOUCH, serverUrl } from '../config';
import { Input } from '../input/Input';
import type { MatchResult, ProfileStore, Settings } from '../meta/profile';
import { haptic, setHapticsEnabled } from '../platform/haptics';
import { Renderer } from '../render/Renderer';
import { UI } from '../ui/UI';
import type { DeathInfo } from '../ui/UI';
import { LocalSession } from './LocalSession';
import { NetSession } from './NetSession';
import type { FrameOutput, Session, ViewCore } from './session';

type State = 'menu' | 'connecting' | 'playing' | 'dying' | 'dead';

interface Life {
  kills: number;
  moonsBroken: number;
  peak: number;
  start: number;
  captures: number;
  dust: number;
  bestRank: number;
  lastMoons: number;
  streak: number;
  hadCrown: boolean;
}

const STREAK_CALLS = ['', 'BITE!', 'DOUBLE BITE!', 'TRIPLE BITE!', 'RAMPAGE!', 'UNSTOPPABLE!', 'MOON LORD!'];

/**
 * Top-level orchestrator: owns the session (offline or online), wires sim events to
 * rendering, audio, haptics and UI, and runs the frame loop.
 */
export class Game {
  private renderer: Renderer;
  private input: Input;
  private ui: UI;
  private local = new LocalSession();
  private session: Session = this.local;
  private state: State = 'menu';
  private last = performance.now();
  private out: FrameOutput = { events: [], added: [], removed: [] };
  private life: Life = this.freshLife();
  private hitstop = 0;
  private deathTimer = 0;
  private deathInfo: DeathInfo | null = null;
  private focus = { x: 0, y: 0, orbitR: 80, vx: 0, vy: 0 };
  private attractId: number | null = null;
  private attractTimer = 0;
  private boardTimer = 0;
  private miniTimer = 0;
  private rankTimer = 0;
  private wasSurging = false;
  private onlineUrl = serverUrl();
  private onlineOk = false;
  private tutorialClock = 0;

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private profile: ProfileStore,
  ) {
    this.renderer = new Renderer(canvas);
    this.ui = new UI(uiRoot, profile, {
      onPlay: () => void this.play(),
      onRespawn: () => this.respawn(),
      onMenu: () => this.toMenu(),
      onExit: () => this.exitMatch(),
      onSettings: (s) => this.applySettings(s),
    });
    this.input = new Input(canvas, uiRoot);
    this.applySettings(profile.data.settings);
    this.ui.showMenu();
    void this.probeServer();

    // first touch anywhere unlocks audio on iOS
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  start(): void {
    const frame = (now: number) => {
      this.frame(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private freshLife(): Life {
    return { kills: 0, moonsBroken: 0, peak: 0, start: performance.now(), captures: 0, dust: 0, bestRank: 99, lastMoons: -1, streak: 0, hadCrown: false };
  }

  private applySettings(s: Settings): void {
    audio.setSfx(s.sfx);
    audio.setMusic(s.music);
    setHapticsEnabled(s.haptics);
    this.renderer.setQuality(s.quality);
    this.input.leftHanded = s.leftHanded;
    this.input.setVisible(this.state === 'playing');
  }

  private async probeServer(): Promise<void> {
    if (!this.onlineUrl) {
      this.ui.setNet('offline');
      return;
    }
    this.ui.setNet('probing');
    const ms = await NetSession.probe(this.onlineUrl);
    this.onlineOk = ms !== null;
    this.ui.setNet(this.onlineOk ? 'online' : 'offline', ms ?? undefined);
  }

  // ───────────────────────────────────────── flow

  private async play(): Promise<void> {
    if (this.state !== 'menu' && this.state !== 'dead') return;
    audio.unlock();
    const name = this.ui.playerName;
    const skin = this.profile.data.skin;
    if (this.onlineOk && this.onlineUrl) {
      this.state = 'connecting';
      this.ui.setConnecting(true);
      const net = await NetSession.connect(this.onlineUrl, name, skin);
      this.ui.setConnecting(false);
      if (net) {
        this.session = net;
        this.startLife();
        return;
      }
      this.onlineOk = false;
      this.ui.setNet('offline');
      this.ui.toast('Servers unreachable — playing the offline arena');
    }
    this.session = this.local;
    this.local.spawn(name, skin);
    this.startLife();
  }

  private startLife(): void {
    this.state = 'playing';
    this.life = this.freshLife();
    this.deathInfo = null;
    this.tutorialClock = 0;
    this.ui.closeModal();
    this.ui.showHud();
    this.ui.setNetBadge(this.session.kind === 'online' ? 'online' : 'offline arena');
    this.input.reset();
    this.input.setVisible(true);
    audio.setIntensity(1);
  }

  private respawn(): void {
    if (this.state !== 'dead') return;
    if (this.session.lost) {
      this.toMenu();
      return;
    }
    this.session.spawn(this.ui.playerName, this.profile.data.skin);
    this.startLife();
  }

  private toMenu(): void {
    if (this.session !== this.local) {
      this.session.leave();
      this.session.dispose();
      this.session = this.local;
    }
    this.local.leave();
    this.state = 'menu';
    this.input.setVisible(false);
    this.input.reset();
    audio.surge(false);
    audio.setIntensity(0);
    this.ui.showMenu();
    void this.probeServer();
  }

  private exitMatch(): void {
    if (this.state === 'playing') {
      const r = this.profile.applyMatch(this.result());
      this.ui.toast(`+${r.xp} XP · +${r.coins} coins`);
    }
    this.toMenu();
  }

  private result(): MatchResult {
    return {
      peakMass: this.life.peak,
      kills: this.life.kills,
      moonsBroken: this.life.moonsBroken,
      aliveSecs: (performance.now() - this.life.start) / 1000,
      bestRank: this.life.bestRank,
      captures: this.life.captures,
      dust: this.life.dust,
    };
  }

  private onDeath(cause: 'bite' | 'rim' | 'lost', killer: string): void {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.deathTimer = cause === 'lost' ? 0.2 : 1.3;
    this.input.reset();
    this.input.setVisible(false);
    this.ui.hint(null);
    audio.surge(false);
    audio.death();
    audio.setIntensity(0);
    haptic('fail');
    this.renderer.addShake(0.8);
    this.renderer.addFlash(0.35, '#FF4D6D');
    const r = this.result();
    const rewards = this.profile.applyMatch(r);
    this.deathInfo = {
      cause,
      killer,
      mass: r.peakMass,
      rank: Math.min(r.bestRank, this.session.population()),
      kills: r.kills,
      secs: r.aliveSecs,
      rewards,
      best: this.profile.data.best.mass,
    };
    if (this.session === this.local) this.local.meId = null;
  }

  // ───────────────────────────────────────── frame

  private me(): ViewCore | undefined {
    const id = this.session.meId;
    return id !== null ? this.session.cores.get(id) : undefined;
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const playing = this.state === 'playing';
    this.input.enabled = playing;
    this.input.update();

    let timeScale = 1;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      timeScale = 0.12;
    } else if (this.state === 'dying') {
      timeScale = 0.35;
    }

    this.session.update(dt, playing ? { angle: this.input.angle, surge: this.input.surge } : null, timeScale);
    if (this.session.kind === 'online' && this.session.lost && (this.state === 'playing' || this.state === 'dying')) {
      if (this.state === 'playing') this.onDeath('lost', '');
    }

    this.session.drain(this.out);
    this.handleFrame();
    this.out.events.length = this.out.added.length = this.out.removed.length = 0;

    const me = this.me();
    this.updateCamera(me, dt);
    if (playing && me) this.updatePlayer(me, dt);

    const board = this.session.board();
    const crownId = board[0]?.id ?? null;
    this.renderer.render(this.session, dt * Math.max(timeScale, 0.3), { meId: this.session.meId, crownId, attract: this.state === 'menu' });

    if (this.state === 'playing' || this.state === 'dying') this.updateHud(me, board, crownId, dt);

    if (this.state === 'dying') {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0 && this.deathInfo) {
        this.state = 'dead';
        this.ui.showDeath(this.deathInfo);
      }
    }
    this.ui.tick(dt);
  }

  private updateCamera(me: ViewCore | undefined, dt: number): void {
    const r = this.renderer;
    if (me) {
      this.focus = { x: me.x, y: me.y, orbitR: me.orbitR, vx: me.vx, vy: me.vy };
      r.follow(me.x, me.y, me.orbitR, me.vx, me.vy, dt);
      const s = r.worldToScreen(me.x, me.y);
      this.input.setOrigin(s.x, s.y);
      return;
    }
    if (this.state === 'menu' || this.state === 'connecting') {
      // attract mode: drift between interesting cores
      this.attractTimer -= dt;
      let target = this.attractId !== null ? this.session.cores.get(this.attractId) : undefined;
      if (!target || this.attractTimer <= 0) {
        const ranked = [...this.session.cores.values()].sort((a, b) => b.mass - a.mass).slice(0, 6);
        target = ranked[Math.floor(Math.random() * ranked.length)];
        this.attractId = target?.id ?? null;
        this.attractTimer = 9;
      }
      if (target) {
        const k = Math.min(1, dt * 0.8);
        this.focus.x += (target.x - this.focus.x) * k;
        this.focus.y += (target.y - this.focus.y) * k;
        this.focus.orbitR = target.orbitR * 1.6 + 80;
      }
      r.follow(this.focus.x, this.focus.y, this.focus.orbitR, 0, 0, dt);
      return;
    }
    // dead / waiting: hold on the spot, slowly push in
    this.focus.orbitR = Math.max(40, this.focus.orbitR - dt * 30);
    r.follow(this.focus.x, this.focus.y, this.focus.orbitR, 0, 0, dt);
  }

  private updatePlayer(me: ViewCore, dt: number): void {
    const life = this.life;
    life.peak = Math.max(life.peak, me.mass);

    // moon regen feedback
    if (life.lastMoons >= 0 && me.moons.length > life.lastMoons) {
      audio.moonGained();
      haptic('light');
      this.renderer.moonGained(me);
    }
    life.lastMoons = me.moons.length;

    // surge state
    const canSurge = me.mass > SURGE_MIN_MASS;
    this.input.setSurgeAvailable(canSurge);
    this.input.setSurgeMeter(clamp((me.mass - SURGE_MIN_MASS) / 200, 0.08, 1));
    if (me.surging !== this.wasSurging) {
      audio.surge(me.surging);
      if (me.surging) haptic('tick');
      this.wasSurging = me.surging;
    }

    // rim warning
    const R = this.session.arenaRadius;
    const toRim = R - Math.hypot(me.x, me.y) - me.r;
    this.renderer.setRimDanger(clamp(1 - toRim / 380, 0, 1));

    // music tension when something dangerous is close
    let danger = me.surging ? 1 : 0;
    for (const c of this.session.cores.values()) {
      if (c === me) continue;
      const reach = c.orbitR * SURGE_ORBIT_MULT + me.r + 120;
      if ((c.x - me.x) ** 2 + (c.y - me.y) ** 2 < reach * reach) danger = 1;
    }
    audio.setIntensity(1 + danger);

    this.rankTimer -= dt;
    if (this.rankTimer <= 0) {
      this.rankTimer = 0.5;
      life.bestRank = Math.min(life.bestRank, this.session.rankOf(me.id));
    }

    this.tutorial(me, dt);
  }

  private tutorial(me: ViewCore, dt: number): void {
    const p = this.profile.data;
    if (p.tutorialSteps >= 3) {
      this.ui.hint(null);
      return;
    }
    this.tutorialClock += dt;
    const steer = IS_TOUCH ? 'Drag your <b>left thumb</b> to steer' : 'Move your <b>mouse</b> to steer';
    const surge = IS_TOUCH ? '<b>Hold the right side</b> to SURGE — faster, wider orbit' : '<b>Hold click</b> or <b>Space</b> to SURGE — faster, wider orbit';
    switch (p.tutorialSteps) {
      case 0:
        this.ui.hint(`${steer} · eat <b>stardust</b> to grow`);
        if (this.input.steered && this.tutorialClock > 3) this.advanceTutorial();
        break;
      case 1:
        this.ui.hint('Your <b>moons</b> are your teeth — swing them into another core to <b>BITE</b> it');
        if (this.tutorialClock > 7) this.advanceTutorial();
        break;
      case 2:
        if (me.mass > SURGE_MIN_MASS + 4) this.ui.hint(surge);
        else this.ui.hint('Keep eating — <b>surge</b> unlocks at 30 mass');
        if (this.input.surgedOnce && me.mass > SURGE_MIN_MASS) this.advanceTutorial();
        break;
    }
  }

  private advanceTutorial(): void {
    this.profile.data.tutorialSteps++;
    this.profile.save();
    this.tutorialClock = 0;
    this.ui.hint(null);
  }

  private updateHud(me: ViewCore | undefined, board: ReturnType<Session['board']>, crownId: number | null, dt: number): void {
    if (me) this.ui.updateScore(me.mass, me.moons.length, this.session.rankOf(me.id));

    // crown moments
    if (me && crownId === me.id && !this.life.hadCrown && this.session.population() > 3) {
      this.life.hadCrown = true;
      this.ui.announce("YOU'RE #1", 'everyone can see your crown', 'mint');
      haptic('success');
      audio.levelUp();
    }

    this.boardTimer -= dt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.5;
      const meInfo = me ? { mass: me.mass, rank: this.session.rankOf(me.id), name: me.name } : null;
      this.ui.updateBoard(board, this.session.meId, meInfo, this.session.population());
    }
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 1 / 15;
      this.ui.minimap.draw(this.session, this.session.meId, crownId, 1 / 15);
    }
    const sf = this.session.starfall;
    this.ui.starfallAlert(sf && sf.in > 0 ? sf.in : null);
  }

  // ───────────────────────────────────────── events → feedback

  private nearness(x: number, y: number): number {
    const r = this.renderer;
    const d = Math.hypot(x - r.cam.x, y - r.cam.y) * r.cam.zoom;
    return clamp(1 - d / (Math.max(r.w, r.h) * 0.75), 0, 1);
  }

  private handleFrame(): void {
    const meId = this.session.meId;
    const rend = this.renderer;
    const sf = this.session.starfall;
    for (const d of this.out.added) rend.onDustAdded(d, sf);
    for (const d of this.out.removed) {
      const eater = rend.onDustRemoved(d, this.session.cores);
      if (eater && eater.id === meId && this.state === 'playing') {
        this.life.dust += d.v;
        audio.pickup(d.v);
        if (d.c === 6) haptic('tick');
      }
    }
    for (const e of this.out.events) this.handleEvent(e, meId);
  }

  private handleEvent(e: GameEvent, meId: number | null): void {
    const rend = this.renderer;
    const playing = this.state === 'playing';
    switch (e.t) {
      case 'kill': {
        const near = this.nearness(e.x, e.y);
        const byMe = e.killer !== null && e.killer === meId;
        rend.killAt(e.x, e.y, e.vskin, coreRadius(e.vmass), near > 0.4, byMe);
        if (playing || this.state === 'dying') this.ui.feed(e.killer !== null ? e.kname : null, e.vname, byMe, e.victim === meId);
        if (byMe && playing) {
          this.life.kills++;
          this.life.streak = e.streak;
          const call = STREAK_CALLS[Math.min(e.streak, STREAK_CALLS.length - 1)];
          this.ui.announce(call, `${e.vname} · +${Math.round(e.vmass * 0.75)} dust`, e.streak >= 3 ? 'pink' : 'yellow');
          audio.bite(e.streak);
          haptic('heavy');
          if (this.session.kind === 'local') this.hitstop = 0.09;
          rend.coreHappy(meId!);
          rend.floatText(e.x, e.y - 30, 'CHOMP!', '#FFE45C', 34);
        } else if (playing) {
          audio.remoteKill(near);
        }
        if (e.victim === meId && meId !== null) this.onDeath(e.cause, e.kname);
        break;
      }
      case 'clash': {
        const ca = this.session.cores.get(e.a);
        const cb = this.session.cores.get(e.b);
        const colA = ca ? skinById(ca.skin).moon : '#FFFFFF';
        const colB = cb ? skinById(cb.skin).moon : '#FFFFFF';
        const mine = e.a === meId || e.b === meId;
        const near = this.nearness(e.x, e.y);
        rend.clashAt(e.x, e.y, colA, colB, mine);
        if (this.state !== 'menu') audio.clash(mine ? 1 : near * 0.5);
        if (mine && playing) {
          this.life.moonsBroken++;
          haptic('medium');
        }
        break;
      }
      case 'capture': {
        if (e.core === meId && playing) {
          this.life.captures++;
          audio.capture();
          haptic('light');
          rend.floatText(e.x, e.y - 20, '+1 MOON', '#7CF5C8', 22);
        }
        rend.effects.ring(e.x, e.y, '#7CF5C8', 6, 50, 0.35, 4);
        break;
      }
      case 'starfallWarn':
        if (playing) audio.starfallWarn();
        break;
      case 'starfall': {
        const near = this.nearness(e.x, e.y);
        if (playing) audio.starfallImpact(near);
        if (near > 0.3) rend.addShake(0.35 * near);
        rend.effects.ring(e.x, e.y, '#FFE45C', e.r * 0.3, e.r * 1.4, 0.8, 12);
        break;
      }
      case 'spawn':
        break;
    }
  }
}
