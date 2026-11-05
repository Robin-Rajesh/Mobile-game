import { powerDef } from '../../../shared/powers';
import { audio } from '../audio/Audio';
import { serverUrl } from '../config';
import { Input } from '../input/Input';
import type { MatchResult, ProfileStore, Settings } from '../meta/profile';
import { haptic, setHapticsEnabled } from '../platform/haptics';
import { Renderer } from '../render/Renderer';
import { POWER_ICON } from '../ui/powerIcons';
import { UI } from '../ui/UI';
import type { DeathInfo } from '../ui/UI';
import { CameraDirector } from './CameraDirector';
import { HudSync } from './HudSync';
import { LocalSession } from './LocalSession';
import { NetSession } from './NetSession';
import { PlayerSync } from './PlayerSync';
import { Round } from './round';
import type { FrameOutput, Session, ViewCore } from './session';
import { Tutorial } from './Tutorial';
import { dispatchFeedback } from './feedback';
import type { FeedbackContext } from './feedback';

type State = 'menu' | 'connecting' | 'playing' | 'dying' | 'dead';
type DeathCause = DeathInfo['cause'];

/**
 * Top-level orchestrator. Owns the match flow (menu → play → death → again), the session
 * (offline or online) and the frame loop. Everything else is delegated:
 *   sim events      → feedback/*   (per-feature handlers)
 *   player state    → PlayerSync
 *   HUD             → HudSync
 *   camera          → CameraDirector
 *   first-run hints → Tutorial
 */
export class Game {
  private readonly renderer: Renderer;
  private readonly input: Input;
  private readonly ui: UI;
  private readonly camera: CameraDirector;
  private readonly playerSync: PlayerSync;
  private readonly hud: HudSync;
  private readonly tutorial: Tutorial;
  private readonly feedback: FeedbackContext;

  private readonly local = new LocalSession();
  private session: Session = this.local;
  private state: State = 'menu';
  private round = new Round();
  private last = performance.now();
  private readonly out: FrameOutput = { events: [], added: [], removed: [] };
  private hitstopLeft = 0;
  private deathTimer = 0;
  private deathInfo: DeathInfo | null = null;
  private readonly onlineUrl = serverUrl();
  private onlineOk = false;
  private readonly debugBlood = new URLSearchParams(location.search).has('bloodmoon');

  constructor(
    canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
    private readonly profile: ProfileStore,
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
    this.camera = new CameraDirector(this.renderer);
    this.playerSync = new PlayerSync(this.renderer, this.ui, this.input);
    this.hud = new HudSync(this.ui);
    this.tutorial = new Tutorial(profile, this.ui, this.input);
    this.feedback = this.createFeedbackContext();

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

  /** The narrow window feedback handlers see into the game. */
  private createFeedbackContext(): FeedbackContext {
    const g = this;
    return {
      renderer: this.renderer,
      ui: this.ui,
      profile: this.profile,
      get session() {
        return g.session;
      },
      get round() {
        return g.round;
      },
      get meId() {
        return g.session.meId;
      },
      get playing() {
        return g.state === 'playing';
      },
      get inMatch() {
        return g.state === 'playing' || g.state === 'dying';
      },
      get inMenu() {
        return g.state === 'menu';
      },
      me: () => this.me(),
      nearness: (x, y) => this.nearness(x, y),
      hitstop: (secs) => (this.hitstopLeft = secs),
      died: (cause, killer, killerSkin) => this.onDeath(cause, killer, killerSkin),
    };
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
    const { skin, power } = this.profile.data;
    const name = this.ui.playerName;
    if (this.onlineOk && this.onlineUrl) {
      this.state = 'connecting';
      this.ui.setConnecting(true);
      const net = await NetSession.connect(this.onlineUrl, name, skin, power);
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
    this.local.spawn(name, skin, power);
    this.startLife();
  }

  private startLife(): void {
    this.state = 'playing';
    this.round = new Round();
    this.deathInfo = null;
    this.ui.closeModal();
    this.ui.showHud();
    this.ui.setNetBadge(this.session.kind === 'online' ? 'online' : 'offline arena');
    this.input.reset();
    this.input.setVisible(true);
    const pd = powerDef(this.profile.data.power);
    this.input.setPowerIcon(POWER_ICON[pd.id], pd.color);
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
    const r = this.round;
    return {
      peakMass: r.peak,
      kills: r.kills,
      moonsBroken: r.moonsBroken,
      aliveSecs: r.aliveSecs,
      bestRank: r.bestRank,
      captures: r.captures,
      dust: r.dust,
      banished: r.banished,
      dawns: r.dawns,
      tricks: r.tricks,
    };
  }

  private pressPower(): void {
    if (this.state !== 'playing' || !this.me()) return;
    const pw = this.round.power;
    if (!pw.armed && performance.now() < pw.cdUntil) {
      audio.denied();
      haptic('tick');
      return;
    }
    this.session.usePower();
  }

  private onDeath(cause: DeathCause, killer: string, killerSkin: number | null = null): void {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.deathTimer = cause === 'lost' ? 0.2 : 1.3;
    if (this.playDeathCam(cause, killer, killerSkin)) this.deathTimer = 2.5;
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

  /** Blood Moon deaths get the full-screen kill-cam. */
  private playDeathCam(cause: DeathCause, killer: string, killerSkin: number | null): boolean {
    const byWraith = cause === 'wraith';
    if (!byWraith && !(cause === 'bite' && this.session.blood.phase === 'dark' && killerSkin !== null)) return false;
    const titles = byWraith ? ['TAKEN', 'DEVOURED', 'CLAIMED', 'GONE'] : ['BETRAYED', 'BUTCHERED', 'SNUFFED'];
    this.renderer.cinematic.play({
      full: true,
      attacker: byWraith ? { kind: 'wraith' } : { kind: 'core', skin: killerSkin!, spooky: true },
      victim: { kind: 'core', skin: this.profile.data.skin },
      title: titles[Math.floor(Math.random() * titles.length)],
      sub: byWraith ? 'the dark got you' : `by ${killer}`,
    });
    audio.cine('', 'start');
    return true;
  }

  // ───────────────────────────────────────── frame

  private me(): ViewCore | undefined {
    const id = this.session.meId;
    return id !== null ? this.session.cores.get(id) : undefined;
  }

  private nearness(x: number, y: number): number {
    const r = this.renderer;
    const d = Math.hypot(x - r.cam.x, y - r.cam.y) * r.cam.zoom;
    return Math.max(0, Math.min(1, 1 - d / (Math.max(r.w, r.h) * 0.75)));
  }

  private timeScale(dt: number): number {
    if (this.renderer.cinematic.active && this.session.kind === 'local') return 0.18;
    if (this.hitstopLeft > 0) {
      this.hitstopLeft -= dt;
      return 0.12;
    }
    return this.state === 'dying' ? 0.35 : 1;
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const playing = this.state === 'playing';
    const inMatch = playing || this.state === 'dying';

    // input + simulation
    this.input.enabled = playing;
    this.input.update();
    this.renderer.cinematic.update(dt);
    this.ui.setCinematic(this.renderer.cinematic.active);
    const timeScale = this.timeScale(dt);
    this.session.update(dt, playing ? { angle: this.input.angle, surge: this.input.surge } : null, timeScale);
    if (playing && this.session.kind === 'online' && this.session.lost) this.onDeath('lost', '');

    // sim output → feedback
    this.session.drain(this.out);
    this.applyFrameOutput();

    // camera, player, HUD
    const me = this.me();
    this.camera.update(this.session, me, me ? 'follow' : this.state === 'menu' || this.state === 'connecting' ? 'attract' : 'linger', dt);
    if (me) {
      const s = this.renderer.worldToScreen(me.x, me.y);
      this.input.setOrigin(s.x, s.y);
    }
    if (playing && me) {
      this.playerSync.update(this.session, me, this.round, dt);
      this.tutorial.update(me, this.round, dt);
    } else {
      this.playerSync.relax(dt);
    }

    const board = this.session.board();
    const crownId = board[0]?.id ?? null;
    this.renderer.render(this.session, dt * Math.max(timeScale, 0.3), {
      meId: this.session.meId,
      crownId,
      attract: this.state === 'menu',
      myDecoys: this.round.myDecoys,
      disguised: this.round.disguised,
    });
    if (inMatch) this.hud.update(this.session, me, this.round, board, crownId, dt);
    audio.setHorror(inMatch ? this.renderer.blood.horror : 0);

    if (this.state === 'dying') {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0 && this.deathInfo) {
        this.state = 'dead';
        this.ui.showDeath(this.deathInfo);
      }
    }
    this.ui.tick(dt);
  }

  /** Dust in/out drives pickup juice; every sim event goes through the feedback registry. */
  private applyFrameOutput(): void {
    const { out, renderer: rend, session } = this;
    const meId = session.meId;
    for (const d of out.added) rend.onDustAdded(d, session.starfall);
    for (const d of out.removed) {
      const eater = rend.onDustRemoved(d, session.cores);
      if (eater && eater.id === meId && this.state === 'playing') {
        this.round.dust += d.v;
        audio.pickup(d.v);
        if (d.c === 6) haptic('tick');
      }
    }
    for (const e of out.events) dispatchFeedback(e, this.feedback);
    out.events.length = out.added.length = out.removed.length = 0;
  }
}
