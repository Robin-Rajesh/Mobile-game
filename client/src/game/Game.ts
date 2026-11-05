import { SURGE_MIN_MASS, SURGE_ORBIT_MULT, coreRadius } from '../../../shared/constants';
import { clamp } from '../../../shared/math';
import { BUBBLE_SECS, powerDef } from '../../../shared/powers';
import { POWER_ICON } from '../ui/powerIcons';
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
  banished: number;
  dawns: number;
  radiantUntil: number;
  tricks: number;
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
  private heartbeat = 0;
  private pw = { cdUntil: 0, cdTotal: 1, armed: false };
  private myDecoys = new Set<number>();
  private disguised = false;
  private disguiseOffAt = 0;
  private wasBlind = false;
  private bloodHintUntil = 0;
  private readonly debugBlood = new URLSearchParams(location.search).has('bloodmoon');

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
    this.input.onPower = () => this.pressPower();
    this.renderer.cinematic.onImpact = (v) => {
      audio.cine(v, 'impact');
      haptic('heavy');
      this.renderer.addShake(0.6);
    };
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
    return { kills: 0, moonsBroken: 0, peak: 0, start: performance.now(), captures: 0, dust: 0, bestRank: 99, lastMoons: -1, streak: 0, hadCrown: false, banished: 0, dawns: 0, radiantUntil: 0, tricks: 0 };
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
      const net = await NetSession.connect(this.onlineUrl, name, skin, this.profile.data.power);
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
    this.local.spawn(name, skin, this.profile.data.power);
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
    const pd = powerDef(this.profile.data.power);
    this.input.setPowerIcon(POWER_ICON[pd.id], pd.color);
    this.pw = { cdUntil: 0, cdTotal: 1, armed: false };
    this.myDecoys.clear();
    this.disguised = false;
    this.wasBlind = false;
    audio.setIntensity(1);
    if (this.debugBlood && this.session === this.local) this.local.triggerBloodMoon(7);
  }

  private respawn(): void {
    if (this.state !== 'dead') return;
    if (this.session.lost) {
      this.toMenu();
      return;
    }
    this.session.spawn(this.ui.playerName, this.profile.data.skin, this.profile.data.power);
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
      banished: this.life.banished,
      dawns: this.life.dawns,
      tricks: this.life.tricks,
    };
  }

  private pressPower(): void {
    if (this.state !== 'playing' || !this.me()) return;
    if (!this.pw.armed && performance.now() < this.pw.cdUntil) {
      audio.denied();
      haptic('tick');
      return;
    }
    this.session.usePower();
  }

  private onDeath(cause: 'bite' | 'rim' | 'lost' | 'wraith', killer: string, killerSkin: number | null = null): void {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.deathTimer = cause === 'lost' ? 0.2 : 1.3;
    // Blood Moon deaths get the full kill-cam
    const mySkin = this.profile.data.skin;
    if (cause === 'wraith' || (cause === 'bite' && this.session.blood.phase === 'dark' && killerSkin !== null)) {
      const titles = cause === 'wraith' ? ['TAKEN', 'DEVOURED', 'CLAIMED', 'GONE'] : ['BETRAYED', 'BUTCHERED', 'SNUFFED'];
      this.renderer.cinematic.play({
        full: true,
        attacker: cause === 'wraith' ? { kind: 'wraith' } : { kind: 'core', skin: killerSkin!, spooky: true },
        victim: { kind: 'core', skin: mySkin },
        title: titles[Math.floor(Math.random() * titles.length)],
        sub: cause === 'wraith' ? 'the dark got you' : `by ${killer}`,
      });
      audio.cine('', 'start');
      this.deathTimer = 2.5;
    }
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

    const cine = this.renderer.cinematic;
    cine.update(dt);
    this.ui.setCinematic(cine.active);
    let timeScale = 1;
    if (cine.active && this.session.kind === 'local') timeScale = 0.18;
    else if (this.hitstop > 0) {
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
    this.renderer.render(this.session, dt * Math.max(timeScale, 0.3), {
      meId: this.session.meId,
      crownId,
      attract: this.state === 'menu',
      myDecoys: this.myDecoys,
      disguised: this.disguised,
    });
    if (this.state !== 'playing') this.renderer.blind = Math.max(0, this.renderer.blind - dt * 2);

    if (this.state === 'playing' || this.state === 'dying') this.updateHud(me, board, crownId, dt);
    audio.setHorror(this.state === 'playing' || this.state === 'dying' ? this.renderer.horror : 0);
    if (this.state !== 'playing') this.renderer.fear = Math.max(0, this.renderer.fear - dt);

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

    // power button state
    const now = performance.now();
    const left = Math.max(0, this.pw.cdUntil - now) / 1000;
    this.input.setPowerState(this.pw.armed ? 0 : left / Math.max(0.1, this.pw.cdTotal), this.pw.armed);

    // caught in someone else's Blackout?
    let blind = false;
    for (const b of this.session.blackouts) {
      if (b.owner !== me.id && (me.x - b.x) ** 2 + (me.y - b.y) ** 2 < b.r * b.r) blind = true;
    }
    this.renderer.blind += ((blind ? 1 : 0) - this.renderer.blind) * Math.min(1, dt * (blind ? 6 : 2));
    if (blind && !this.wasBlind) {
      this.ui.announce('BLACKOUT!', 'someone cut your lights', 'pink');
      audio.power('blackout');
      haptic('medium');
    }
    this.wasBlind = blind;

    this.rankTimer -= dt;
    if (this.rankTimer <= 0) {
      this.rankTimer = 0.5;
      life.bestRank = Math.min(life.bestRank, this.session.rankOf(me.id));
    }

    // Blood Moon fear: nearest hunting wraith drives the heartbeat
    let nearest = Infinity;
    for (const wr of this.session.wraiths) {
      if (wr.scared) continue;
      nearest = Math.min(nearest, Math.hypot(wr.x - me.x, wr.y - me.y));
    }
    const fear = me.radiant > 0 ? 0 : clamp(1 - (nearest - 80) / 650, 0, 1);
    this.renderer.fear += (fear - this.renderer.fear) * Math.min(1, dt * 4);
    this.heartbeat -= dt;
    if (this.renderer.fear > 0.5 && this.heartbeat <= 0) {
      this.heartbeat = 0.9 - this.renderer.fear * 0.45;
      haptic('light');
    }
    if (this.renderer.horror > 0.6) audio.setIntensity(2);

    if (performance.now() < this.bloodHintUntil) {
      this.ui.hint('Wraiths can’t be bitten — your moons only <b>slow</b> them. Grab a <b>☀ sunstone</b> and turn the hunt around');
      return;
    }
    this.tutorial(me, dt);
  }

  private tutorial(me: ViewCore, dt: number): void {
    const p = this.profile.data;
    if (p.tutorialSteps >= 4) {
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
      case 3: {
        const pd = powerDef(p.power);
        this.ui.hint(`${IS_TOUCH ? 'Tap the <b>power button</b>' : 'Press <b>E</b> / right-click'} to use <b>${pd.name}</b> — ${pd.blurb.toLowerCase()}`);
        if (this.pw.cdUntil > 0 || this.pw.armed) this.advanceTutorial();
        break;
      }
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
    const bl = this.session.blood;
    this.ui.bloodAlert(bl.phase, bl.in, me && me.radiant > 0 ? Math.max(0, (this.life.radiantUntil - performance.now()) / 1000) : 0);
    this.ui.starfallAlert(bl.phase === 'calm' && sf && sf.in > 0 ? sf.in : null);
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
        if (playing || this.state === 'dying') this.ui.feed(e.killer !== null ? e.kname : null, e.vname, byMe, e.victim === meId, e.cause);
        if (byMe && playing && this.session.blood.phase === 'dark' && !this.renderer.cinematic.active) {
          const titles = ['FEAST', 'NO MERCY', 'CRUNCH', 'SAVAGE'];
          this.renderer.cinematic.play({
            full: false,
            attacker: { kind: 'core', skin: this.profile.data.skin },
            victim: { kind: 'core', skin: e.vskin, spooky: true },
            title: titles[Math.floor(Math.random() * titles.length)],
            sub: e.vname,
          });
          audio.cine('', 'start');
        }
        if (byMe && playing && performance.now() - this.disguiseOffAt < 120) {
          this.life.tricks++;
          rend.floatText(e.x, e.y - 60, 'MIMIC BITE!', '#FF9F43', 26);
        }
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
        if (e.victim === meId && meId !== null) {
          const ks = e.killer !== null ? this.session.cores.get(e.killer)?.skin ?? null : null;
          this.onDeath(e.cause, e.kname, ks);
        }
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
      case 'power': {
        if (e.kind === 'bubble') rend.bubble(e.core, BUBBLE_SECS);
        if (e.core === meId) {
          if (e.phase === 'armed') {
            this.pw.armed = true;
            rend.floatText(this.me()?.x ?? 0, (this.me()?.y ?? 0) - 50, 'PORTAL SET', '#B9A6FF', 20);
          } else {
            this.pw.armed = false;
            this.pw.cdUntil = performance.now() + e.cd * 1000;
            this.pw.cdTotal = Math.max(0.1, e.cd);
          }
          if (e.phase !== 'expire' && playing) {
            audio.power(e.kind);
            haptic('light');
          }
        } else if (playing && e.kind !== 'blackout' && this.nearness(this.session.cores.get(e.core)?.x ?? 1e9, this.session.cores.get(e.core)?.y ?? 1e9) > 0.5) {
          audio.power(e.kind);
        }
        break;
      }
      case 'warp': {
        rend.effects.ring(e.fx, e.fy, '#7C5CFF', 90, 4, 0.35, 8);
        rend.effects.ring(e.x, e.y, '#62F2FF', 6, 120, 0.45, 8);
        rend.effects.spark(e.x, e.y, '#B9A6FF', 16, 500, 0.45);
        for (let i = 0; i <= 10; i++) {
          const k = i / 10;
          rend.effects.dot(e.fx + (e.x - e.fx) * k, e.fy + (e.y - e.fy) * k, 0, 0, 'rgba(124,92,255,0.7)', 8, 0.35 + k * 0.2);
        }
        if (playing) audio.warp(Math.max(this.nearness(e.x, e.y), this.nearness(e.fx, e.fy)));
        if (e.core === meId) {
          haptic('medium');
          rend.addShake(0.2);
        }
        break;
      }
      case 'decoy': {
        if (e.core === meId) {
          this.myDecoys.add(e.decoy);
          const me = this.me();
          if (me) rend.floatText(me.x, me.y - 50, 'PHANTOM!', '#C49BFF', 22);
        }
        break;
      }
      case 'decoyPop': {
        this.myDecoys.delete(e.id);
        rend.effects.ring(e.x, e.y, '#C49BFF', 10, 90, 0.4, 6);
        for (let i = 0; i < 10; i++) rend.effects.dot(e.x, e.y, (Math.random() - 0.5) * 220, (Math.random() - 0.5) * 220, 'rgba(196,155,255,0.6)', 12, 0.6);
        if (e.owner === meId && e.by !== null && playing) {
          this.life.tricks++;
          this.ui.announce('FOOLED!', `${e.byName} bit your phantom`, 'mint');
          audio.fooled();
          haptic('success');
        } else if (e.by === meId && playing) {
          rend.floatText(e.x, e.y - 30, 'DECOY!', '#FF5C8A', 26);
          audio.denied();
        }
        break;
      }
      case 'snared': {
        rend.effects.ring(e.x, e.y, '#5EE6B0', 8, 70, 0.4, 6);
        rend.effects.spark(e.x, e.y, '#5EE6B0', 10, 300, 0.4);
        if (e.core === meId && playing) {
          this.ui.announce('SNARED!', 'struggle free…', 'pink');
          audio.snareHit(true);
          haptic('heavy');
        } else if (e.by === meId && playing) {
          this.life.tricks++;
          rend.floatText(e.x, e.y - 40, 'GOTCHA!', '#5EE6B0', 28);
          audio.snareHit(false);
          haptic('success');
        }
        break;
      }
      case 'disguise': {
        const c = this.session.cores.get(e.core);
        if (c) for (let i = 0; i < 12; i++) rend.effects.dot(c.x, c.y, (Math.random() - 0.5) * 260, (Math.random() - 0.5) * 260, 'rgba(255,159,67,0.55)', c.r * 0.5, 0.7);
        if (e.core === meId) {
          this.disguised = e.on;
          if (e.on) this.ui.announce('MIMIC', `you look like ${e.name}`, 'yellow');
          else this.disguiseOffAt = performance.now();
        }
        break;
      }
      case 'bloodWarn':
        if (playing) {
          audio.bloodToll();
          this.ui.announce('BLOOD MOON', 'something is waking up…', 'pink');
          haptic('medium');
        }
        break;
      case 'bloodStart':
        rend.addShake(0.5);
        if (playing) {
          audio.bloodStart();
          haptic('heavy');
          this.ui.announce('THEY’RE HUNTING', 'find a ☀ sunstone', 'pink');
          if (!this.profile.data.bloodSeen) {
            this.profile.data.bloodSeen = true;
            this.profile.save();
            this.bloodHintUntil = performance.now() + 7000;
          }
        }
        break;
      case 'bloodEnd':
        for (const [x, y] of e.wraiths) {
          rend.effects.ring(x, y, '#FFE6A8', 10, 120, 0.8, 6);
          rend.effects.spark(x, y, '#A8D8FF', 10, 300, 0.6);
        }
        if (playing && meId !== null && e.survivors.includes(meId)) {
          this.life.dawns++;
          audio.dawn();
          haptic('success');
          this.ui.announce('DAWN', 'you survived · +40 mass', 'mint');
        }
        break;
      case 'wraithSpawn':
        if (playing && e.target === meId) {
          audio.screech(this.nearness(e.x, e.y));
          haptic('medium');
        }
        break;
      case 'ward':
        rend.effects.shards(e.x, e.y, '#3A0711', 6, 240, 7);
        rend.effects.spark(e.x, e.y, '#FF2B4A', 8, 400, 0.3);
        if (e.core === meId && playing) {
          audio.ward();
          haptic('medium');
          rend.addShake(0.2);
        }
        break;
      case 'banish': {
        rend.effects.ring(e.x, e.y, '#FFE45C', 10, 180, 0.6, 10);
        rend.effects.spark(e.x, e.y, '#FFFFFF', 22, 700, 0.5);
        rend.effects.chunks(e.x, e.y, '#0B0410', 12, 400, 9);
        const mine = e.by === meId;
        if (playing) {
          audio.banish(mine);
          this.ui.feed(e.name, 'a wraith', mine, false, 'banish');
        }
        if (mine && playing) {
          this.life.banished++;
          haptic('heavy');
          rend.floatText(e.x, e.y - 30, '+30', '#FFE45C', 30);
          if (!this.renderer.cinematic.active && Math.random() < 0.6) {
            this.renderer.cinematic.play({
              full: false,
              attacker: { kind: 'core', skin: this.profile.data.skin },
              victim: { kind: 'wraith' },
              title: ['BANISHED', 'BEGONE', 'PURGED'][Math.floor(Math.random() * 3)],
              sub: 'back into the dark',
            });
            audio.cine('', 'start');
          } else {
            this.ui.announce('BANISHED!', '+30 mass', 'yellow');
          }
        }
        break;
      }
      case 'sunstone':
        rend.effects.ring(e.x, e.y, '#FFE45C', 10, 220, 0.6, 12);
        rend.effects.spark(e.x, e.y, '#FFE45C', 16, 500, 0.5);
        if (e.core === meId && playing) {
          this.life.radiantUntil = performance.now() + 9000;
          audio.sunstone();
          haptic('success');
          rend.addFlash(0.25, '#FFE45C');
          this.ui.announce('RADIANT!', 'they fear you now — hunt them', 'yellow');
        }
        break;
    }
  }
}
