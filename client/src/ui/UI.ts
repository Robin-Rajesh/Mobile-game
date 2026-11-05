import { NAME_MAX_LEN } from '../../../shared/constants';
import { SKINS, skinById } from '../../../shared/skins';
import type { Skin } from '../../../shared/skins';
import { audio } from '../audio/Audio';
import { IS_TOUCH } from '../config';
import type { BoardEntry } from '../game/session';
import { missionText, xpToNext } from '../meta/profile';
import type { MatchRewards, ProfileStore, Settings } from '../meta/profile';
import { haptic } from '../platform/haptics';
import { Hero } from './Hero';
import { Minimap } from './Minimap';

export interface UIHandlers {
  onPlay(): void;
  onRespawn(): void;
  onMenu(): void;
  onExit(): void;
  onSettings(s: Settings): void;
}

export interface DeathInfo {
  cause: 'bite' | 'rim' | 'lost' | 'wraith';
  killer: string;
  mass: number;
  rank: number;
  kills: number;
  secs: number;
  rewards: MatchRewards;
  best: number;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ICON = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M14 8l4 4-4 4M18 12H9"/></svg>',
};

export class UI {
  readonly minimap: Minimap;
  readonly hero: Hero;
  private el: Record<string, HTMLElement> = {};
  private skinIndex: number;
  private boardKey = '';
  private lastMass = -1;
  private toastTimer = 0;
  private hintText: string | null = null;
  private screen: 'menu' | 'hud' | 'death' = 'menu';

  constructor(
    private root: HTMLElement,
    private profile: ProfileStore,
    private h: UIHandlers,
  ) {
    root.innerHTML = this.template();
    root.querySelectorAll<HTMLElement>('[data-el]').forEach((n) => (this.el[n.dataset.el!] = n));
    this.minimap = new Minimap(this.el.minimap as HTMLCanvasElement);
    this.hero = new Hero(this.el.hero as HTMLCanvasElement);
    this.skinIndex = profile.data.skin;
    this.bind();
    this.refreshProfile();
    this.refreshSkin();
    profile.onChange(() => this.refreshProfile());
  }

  private template(): string {
    const letters = 'MO*NBITE'
      .split('')
      .map((c) => (c === '*' ? '<span class="moon-o" aria-hidden="true"></span>' : `<span>${c}</span>`))
      .join('');
    return `
    <section class="screen menu interactive" data-el="menu">
      <div class="menu-top">
        <div class="chip level-chip" title="Level">
          <div class="level-badge" data-el="lvl">1</div>
          <div class="xp-bar"><i data-el="xp" style="width:0%"></i></div>
        </div>
        <div class="spacer"></div>
        <div class="chip"><span class="coin"></span><span data-el="coins">0</span></div>
        <button class="btn icon ghost" data-act="settings" aria-label="Settings">${ICON.gear}</button>
      </div>
      <div class="menu-body">
        <div class="menu-col">
          <h1 class="logo" aria-label="Moonbite">${letters}</h1>
          <p class="tagline">spin your moons · bite their core</p>
          <div class="hero" data-act="poke"><canvas data-el="hero"></canvas></div>
          <div class="skin-row">
            <button class="btn icon ghost small" data-act="prev" aria-label="Previous skin">${ICON.left}</button>
            <div class="skin-name" data-el="skinName">Mochi<small>Free</small></div>
            <button class="btn icon ghost small" data-act="next" aria-label="Next skin">${ICON.right}</button>
          </div>
        </div>
        <div class="menu-col">
          <input class="name-input" data-el="name" maxlength="${NAME_MAX_LEN}" placeholder="your name" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go" />
          <button class="btn play-btn" data-el="play" data-act="play">PLAY</button>
          <div class="menu-actions">
            <button class="btn ghost small" data-act="missions">Missions<span class="badge-dot" data-el="missionDot" hidden>0</span></button>
            <button class="btn ghost small" data-act="howto">How to play</button>
          </div>
          <div class="net-status" data-el="net"><i></i><span>Finding servers…</span></div>
        </div>
      </div>
    </section>

    <section class="screen hud" data-el="hud">
      <div class="lb"><div class="lb-title"><span>LEADERBOARD</span><span data-el="pop"></span></div><ol data-el="board"></ol></div>
      <div class="score"><div class="mass" data-el="mass">0</div><div class="sub"><span><span class="moon-ic"></span><b data-el="moons">0</b></span><span><b data-el="rank">-</b></span></div></div>
      <canvas class="minimap" data-el="minimap"></canvas>
      <div class="feed" data-el="feed"></div>
      <div class="announce" data-el="announce"></div>
      <div class="sf-alert" data-el="sf">★ STARFALL INCOMING</div>
      <div class="bm-alert" data-el="bm"></div>
      <div class="rad-alert" data-el="rad"></div>
      <div class="hint" data-el="hint"></div>
      <button class="btn icon ghost small hud-exit interactive" data-act="exit" aria-label="Leave match">${ICON.exit}</button>
      <div class="net-badge" data-el="netBadge"></div>
    </section>

    <section class="screen death interactive" data-el="death"><div class="death-inner" data-el="deathInner"></div></section>
    <section class="screen modal interactive" data-el="modal"><div class="modal-card panel" data-el="modalCard"></div></section>
    <section class="screen connecting" data-el="connecting"><div class="spinner"><div class="orb"></div><span>Finding an arena…</span></div></section>
    <div class="toast" data-el="toast"></div>`;
  }

  private bind(): void {
    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      audio.unlock();
      const act = t.dataset.act!;
      if (act !== 'poke') audio.click();
      switch (act) {
        case 'play':
          this.commitName();
          this.h.onPlay();
          break;
        case 'again':
          this.h.onRespawn();
          break;
        case 'menu':
          this.h.onMenu();
          break;
        case 'exit':
          this.confirmExit();
          break;
        case 'prev':
          this.cycleSkin(-1);
          break;
        case 'next':
          this.cycleSkin(1);
          break;
        case 'poke':
          this.hero.poke();
          audio.pop();
          haptic('light');
          break;
        case 'buy':
          this.buySkin();
          break;
        case 'settings':
          this.openSettings();
          break;
        case 'missions':
          this.openMissions();
          break;
        case 'howto':
          this.openHowTo();
          break;
        case 'close':
          this.closeModal();
          break;
        case 'toggle':
          this.toggleSetting(t);
          break;
        case 'leave':
          this.closeModal();
          this.h.onExit();
          break;
      }
    });
    const name = this.el.name as HTMLInputElement;
    name.value = this.profile.data.name;
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        name.blur();
        this.commitName();
        this.h.onPlay();
      }
    });
    name.addEventListener('blur', () => this.commitName());
    // keyboard: Enter on death screen = play again
    window.addEventListener('keydown', (e) => {
      if (this.screen === 'death' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.h.onRespawn();
      }
    });
    // swipe the hero to change skins
    let sx = 0;
    this.el.hero.addEventListener('pointerdown', (e) => (sx = e.clientX));
    this.el.hero.addEventListener('pointerup', (e) => {
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 40) this.cycleSkin(dx < 0 ? 1 : -1);
    });
  }

  private commitName(): void {
    const v = (this.el.name as HTMLInputElement).value.trim().slice(0, NAME_MAX_LEN);
    if (v !== this.profile.data.name) {
      this.profile.data.name = v;
      this.profile.save();
    }
  }

  get playerName(): string {
    return this.profile.data.name || 'moonling';
  }

  // ───────────────────────────────────────── screens

  private show(which: 'menu' | 'hud' | 'death'): void {
    this.screen = which;
    for (const k of ['menu', 'hud', 'death'] as const) this.el[k].classList.toggle('on', k === which);
  }

  showMenu(): void {
    this.show('menu');
    this.refreshProfile();
    this.refreshSkin();
  }

  showHud(): void {
    this.show('hud');
    this.el.feed.innerHTML = '';
    this.el.announce.innerHTML = '';
    this.lastMass = -1;
    this.boardKey = '';
    this.hint(null);
  }

  get current(): 'menu' | 'hud' | 'death' {
    return this.screen;
  }

  setCinematic(on: boolean): void {
    this.root.classList.toggle('cine', on);
  }

  setConnecting(on: boolean): void {
    this.el.connecting.classList.toggle('on', on);
  }

  setNet(status: 'probing' | 'online' | 'offline', ms?: number): void {
    const n = this.el.net;
    n.className = `net-status ${status}`;
    const label = status === 'online' ? `Online · ${ms ?? '?'} ms` : status === 'offline' ? 'Offline arena · bots' : 'Finding servers…';
    n.querySelector('span')!.textContent = label;
  }

  setNetBadge(text: string): void {
    this.el.netBadge.textContent = text;
  }

  toast(msg: string, ms = 2600): void {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('on'), ms);
  }

  // ───────────────────────────────────────── profile / skins

  refreshProfile(): void {
    const d = this.profile.data;
    this.el.lvl.textContent = String(d.level);
    (this.el.xp as HTMLElement).style.width = `${Math.round((d.xp / xpToNext(d.level)) * 100)}%`;
    this.el.coins.textContent = d.coins.toLocaleString();
    const open = d.missions.filter((m) => !m.done).length;
    const dot = this.el.missionDot;
    dot.hidden = open === 0;
    dot.textContent = String(open);
  }

  private cycleSkin(dir: number): void {
    this.skinIndex = (this.skinIndex + dir + SKINS.length) % SKINS.length;
    if (this.profile.isOwned(this.skinIndex)) {
      this.profile.data.skin = this.skinIndex;
      this.profile.save();
    }
    this.hero.poke();
    haptic('tick');
    this.refreshSkin();
  }

  private refreshSkin(): void {
    const skin = skinById(this.skinIndex);
    const owned = this.profile.isOwned(skin.id);
    this.hero.locked = !owned;
    let sub = '';
    if (owned) sub = `<small>${skin.unlock.kind === 'free' ? 'Starter' : 'Unlocked'}</small>`;
    else if (skin.unlock.kind === 'level') sub = `<small class="locked">Reach level ${skin.unlock.level}</small>`;
    else if (skin.unlock.kind === 'coins') {
      const can = this.profile.data.coins >= skin.unlock.price;
      sub = `<small class="locked"><button class="btn small ${can ? 'mint' : 'ghost'}" data-act="buy" style="margin-top:4px;font-size:14px;padding:4px 10px 3px" ${can ? '' : 'disabled'}><span style="display:inline-flex;align-items:center;gap:4px"><span class="coin" style="width:16px;height:16px"></span>${skin.unlock.price}</span></button></small>`;
    }
    this.el.skinName.innerHTML = `${esc(skin.name)}${sub}`;
    const play = this.el.play as HTMLButtonElement;
    play.textContent = owned ? 'PLAY' : `PLAY AS ${skinById(this.profile.data.skin).name.toUpperCase()}`;
    play.style.fontSize = owned ? '' : '22px';
  }

  private buySkin(): void {
    const skin = skinById(this.skinIndex);
    if (this.profile.buySkin(skin)) {
      audio.levelUp();
      haptic('success');
      this.hero.poke();
      this.toast(`${skin.name} unlocked!`);
      this.refreshSkin();
    }
  }

  get selectedSkin(): Skin {
    return skinById(this.skinIndex);
  }

  // ───────────────────────────────────────── modals

  private openModal(html: string): void {
    this.el.modalCard.innerHTML = `<button class="btn icon ghost small modal-close" data-act="close" aria-label="Close">${ICON.close}</button>${html}`;
    this.el.modal.classList.add('on');
  }

  closeModal(): void {
    this.el.modal.classList.remove('on');
  }

  private openSettings(): void {
    const s = this.profile.data.settings;
    const row = (key: keyof Settings, label: string, on: boolean) =>
      `<div class="setting"><span>${label}</span><div class="toggle ${on ? 'on' : ''}" data-act="toggle" data-key="${key}" role="switch" aria-checked="${on}"></div></div>`;
    this.openModal(`<h2>Settings</h2>
      ${row('sfx', 'Sound effects', s.sfx)}
      ${row('music', 'Music', s.music)}
      ${row('haptics', 'Vibration', s.haptics)}
      ${row('quality', 'High quality graphics', s.quality === 'high')}
      ${IS_TOUCH ? row('leftHanded', 'Surge on the left', s.leftHanded) : ''}
      <p class="modal-note">${IS_TOUCH ? 'Left thumb steers · hold the right side to surge' : 'Mouse to steer · hold click or Space to surge'}</p>`);
  }

  private toggleSetting(t: HTMLElement): void {
    const key = t.dataset.key as keyof Settings;
    const s = this.profile.data.settings;
    if (key === 'quality') s.quality = s.quality === 'high' ? 'low' : 'high';
    else (s[key] as boolean) = !(s[key] as boolean);
    const on = key === 'quality' ? s.quality === 'high' : (s[key] as boolean);
    t.classList.toggle('on', on);
    t.setAttribute('aria-checked', String(on));
    this.profile.save();
    this.h.onSettings(s);
    haptic('tick');
  }

  private openMissions(): void {
    this.profile.refreshDaily();
    const d = this.profile.data;
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const hrs = Math.max(0, Math.floor((midnight.getTime() - now.getTime()) / 3_600_000));
    const items = d.missions
      .map((m) => {
        const pct = Math.round((m.progress / m.target) * 100);
        return `<div class="mission ${m.done ? 'done' : ''}">
          <div class="mission-top"><span>${m.done ? '✓ ' : ''}${esc(missionText(m))}</span><span class="rw"><span class="coin" style="width:16px;height:16px"></span>${m.reward}</span></div>
          <div class="prog"><i style="width:${pct}%"></i></div>
          <div class="prog-label">${Math.min(m.progress, m.target)} / ${m.target}</div>
        </div>`;
      })
      .join('');
    this.openModal(`<h2>Daily missions</h2>${items}<p class="modal-note">New missions in ${hrs}h · Day streak: ${d.dayStreak} 🔥</p>`);
  }

  openHowTo(): void {
    const steer = IS_TOUCH ? 'Drag your <b>left thumb</b> anywhere to steer.' : 'Point with your <b>mouse</b> to steer (or WASD).';
    const surge = IS_TOUCH ? '<b>Hold the right side</b> to SURGE' : '<b>Hold click / Space</b> to SURGE';
    this.openModal(`<h2>How to play</h2><div class="howto">
      <div class="howto-item"><div class="ic">✦</div><p>${steer} Eat <b>stardust</b> to grow — bigger cores grow more moons.</p></div>
      <div class="howto-item"><div class="ic" style="color:var(--yellow)">●</div><p>Your moons are your <b>teeth</b>. Swing one into another core to <b>bite</b> it. Keep your own core away from theirs.</p></div>
      <div class="howto-item"><div class="ic" style="color:var(--pink)">»</div><p>${surge}: faster, and your orbit swings wide to snipe. It burns mass — and opens gaps in your guard.</p></div>
      <div class="howto-item"><div class="ic" style="color:var(--mint)">✕</div><p>Moons that collide <b>shatter</b>. Grab loose moons after a bite to steal them. Never touch the <b>red rim</b>.</p></div>
      <div class="howto-item"><div class="ic" style="color:#FFE45C">★</div><p><b>Starfall</b> drops a pile of gold dust somewhere on the map. Everyone sees it. Be first.</p></div>
      <div class="howto-item"><div class="ic" style="color:#FF2B4A">☾</div><p>During a <b>Blood Moon</b> the lights go out and <b>wraiths</b> hunt you. Your moons only slow them. Grab a <b>☀ sunstone</b> to turn Radiant and banish them.</p></div>
    </div>`);
  }

  private confirmExit(): void {
    this.openModal(`<h2>Leave arena?</h2><p style="margin:0 0 16px;color:var(--muted)">You'll keep the XP and coins from this round.</p>
      <div style="display:flex;gap:10px"><button class="btn ghost" style="flex:1" data-act="close">Stay</button><button class="btn pink" style="flex:1" data-act="leave">Leave</button></div>`);
  }

  // ───────────────────────────────────────── HUD

  updateScore(mass: number, moons: number, rank: number): void {
    const m = Math.floor(mass);
    if (m !== this.lastMass) {
      const el = this.el.mass;
      if (m > this.lastMass && this.lastMass >= 0) {
        el.classList.add('bump');
        setTimeout(() => el.classList.remove('bump'), 90);
      }
      el.textContent = m.toLocaleString();
      this.lastMass = m;
    }
    this.el.moons.textContent = String(moons);
    this.el.rank.textContent = rank > 0 ? `#${rank}` : '-';
  }

  updateBoard(entries: BoardEntry[], meId: number | null, me: { mass: number; rank: number; name: string } | null, pop: number): void {
    const key = entries.map((e) => `${e.id}:${e.mass}`).join(',') + (me ? `|${me.rank}:${Math.floor(me.mass)}` : '');
    if (key === this.boardKey) return;
    this.boardKey = key;
    const rows = entries.slice(0, 8).map((e, i) => {
      const s = skinById(e.skin);
      return `<li class="${e.id === meId ? 'me' : ''} ${i === 0 ? 'first' : ''}"><span class="n">${i + 1}</span><span class="sw" style="background:${s.body}"></span><span class="nm">${esc(e.name)}</span><span class="m">${e.mass}</span></li>`;
    });
    if (me && me.rank > 8) {
      rows.push(`<li class="sep"></li><li class="me"><span class="n">${me.rank}</span><span class="nm">${esc(me.name)}</span><span class="m">${Math.floor(me.mass)}</span></li>`);
    }
    this.el.board.innerHTML = rows.join('');
    this.el.pop.textContent = String(pop);
  }

  feed(killer: string | null, victim: string, meKiller: boolean, meVictim: boolean, cause: 'bite' | 'rim' | 'wraith' | 'banish' = 'bite'): void {
    const f = this.el.feed;
    const k = killer ? `<b class="${meKiller ? 'me' : ''}">${esc(killer)}</b>` : '';
    const v = `<b class="${meVictim ? 'me' : ''}">${esc(victim)}</b>`;
    const line = document.createElement('div');
    if (cause === 'wraith') line.innerHTML = `<span class="verb dark">the dark took</span> ${v}`;
    else if (cause === 'banish') line.innerHTML = `${k} <span class="verb gold">banished</span> ${v}`;
    else line.innerHTML = killer ? `${k} <span class="verb">bit</span> ${v}` : `${v} <span class="verb">fell in the void</span>`;
    f.prepend(line);
    while (f.children.length > 4) f.lastElementChild!.remove();
    setTimeout(() => line.remove(), 4200);
  }

  announce(big: string, small = '', color: 'yellow' | 'pink' | 'mint' = 'yellow'): void {
    const a = this.el.announce;
    a.innerHTML = `<div class="big ${color === 'yellow' ? '' : color}">${esc(big)}</div>${small ? `<div class="small">${esc(small)}</div>` : ''}`;
  }

  hint(text: string | null): void {
    if (text === this.hintText) return;
    this.hintText = text;
    const el = this.el.hint;
    if (text) {
      el.innerHTML = text;
      el.classList.add('on');
    } else {
      el.classList.remove('on');
    }
  }

  bloodAlert(phase: 'calm' | 'warn' | 'dark', secs: number, radiant: number): void {
    const el = this.el.bm;
    if (phase === 'calm') el.classList.remove('on');
    else {
      el.classList.add('on');
      const s = Math.max(0, Math.ceil(secs));
      el.innerHTML = phase === 'warn' ? `☾ <span class="lbl">BLOOD MOON IN </span>${s}` : `☾ <span class="lbl">BLOOD MOON · </span>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    const r = this.el.rad;
    if (radiant > 0) {
      r.classList.add('on');
      r.innerHTML = `☀ <span class="lbl">RADIANT </span>${Math.ceil(radiant)}`;
    } else r.classList.remove('on');
  }

  starfallAlert(secs: number | null): void {
    const el = this.el.sf;
    if (secs === null || secs <= 0) {
      el.classList.remove('on');
      return;
    }
    el.classList.add('on');
    el.innerHTML = `★ <span class="lbl">STARFALL IN </span>${Math.ceil(secs)}`;
  }

  // ───────────────────────────────────────── death

  showDeath(info: DeathInfo): void {
    this.show('death');
    const r = info.rewards;
    const title = info.cause === 'rim' ? 'VOIDED!' : info.cause === 'lost' ? 'DISCONNECTED' : info.cause === 'wraith' ? 'TAKEN!' : 'BITTEN!';
    const by =
      info.cause === 'bite' ? `by <b>${esc(info.killer)}</b>` : info.cause === 'rim' ? 'you touched the red rim' : info.cause === 'wraith' ? 'a wraith dragged you into <b>the dark</b>' : 'connection to the arena was lost';
    const mm = Math.floor(info.secs / 60);
    const ss = String(Math.floor(info.secs % 60)).padStart(2, '0');
    const missions = r.missionsCompleted
      .map((m, i) => `<div class="mission-done" style="animation-delay:${0.6 + i * 0.15}s"><span class="tick">✓</span>${esc(missionText(m))}<span class="rw">+${m.reward}</span></div>`)
      .join('');
    const unlocks = r.unlocked.map((s) => `<div class="unlock-banner">NEW SKIN UNLOCKED · ${esc(s.name)}</div>`).join('');
    this.el.deathInner.innerHTML = `
      <h1>${title}</h1>
      <div class="by">${by}</div>
      <div class="stats">
        <div class="stat panel"><div class="v" data-count="${Math.floor(info.mass)}">0</div><div class="k">Peak mass</div></div>
        <div class="stat panel"><div class="v">#${info.rank}</div><div class="k">Best rank</div></div>
        <div class="stat panel"><div class="v">${info.kills}</div><div class="k">Bites</div></div>
        <div class="stat panel"><div class="v">${mm}:${ss}</div><div class="k">Alive</div></div>
      </div>
      ${r.newBest ? '<div class="newbest">NEW PERSONAL BEST!</div>' : `<div class="by">Best: <b>${info.best.toLocaleString()}</b></div>`}
      <div class="rewards panel">
        <div class="reward-row">
          <div class="level-badge" data-el2="lvl">${r.levelBefore}</div>
          <div class="lvl"><div class="lvl-top"><span>Level <span data-el2="lvlTxt">${r.levelBefore}</span></span><span class="gain xp">+<span data-count="${r.xp}">0</span> XP</span></div>
          <div class="xp-bar"><i data-el2="bar" style="width:${Math.round(r.levelProgressBefore * 100)}%"></i></div></div>
          <div class="gain coins"><span class="coin"></span>+<span data-count="${r.coins}">0</span></div>
        </div>
        ${missions}${unlocks}
      </div>
      <div class="death-actions">
        <button class="btn play-btn" data-act="again">PLAY AGAIN</button>
        <button class="btn ghost small" data-act="menu">Main menu</button>
      </div>`;
    this.animateRewards(r);
  }

  private animateRewards(r: MatchRewards): void {
    const root = this.el.deathInner;
    const counters = [...root.querySelectorAll<HTMLElement>('[data-count]')];
    const start = performance.now() + 250;
    const dur = 900;
    let lastTick = 0;
    const step = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / dur));
      const e = 1 - (1 - t) ** 3;
      for (const c of counters) c.textContent = Math.round(Number(c.dataset.count) * e).toLocaleString();
      if (t > 0 && t < 1 && now - lastTick > 70) {
        lastTick = now;
        audio.coin(Math.floor(t * 10));
      }
      if (t < 1 && this.screen === 'death') requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    const bar = root.querySelector<HTMLElement>('[data-el2="bar"]')!;
    const lvl = root.querySelector<HTMLElement>('[data-el2="lvl"]')!;
    const lvlTxt = root.querySelector<HTMLElement>('[data-el2="lvlTxt"]')!;
    setTimeout(() => {
      if (r.levelAfter > r.levelBefore) {
        bar.style.width = '100%';
        setTimeout(() => {
          bar.style.transition = 'none';
          bar.style.width = '0%';
          void bar.offsetWidth;
          bar.style.transition = '';
          bar.style.width = `${Math.round(r.levelProgress * 100)}%`;
          lvl.textContent = lvlTxt.textContent = String(r.levelAfter);
          lvl.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 400, easing: 'cubic-bezier(.2,1.6,.4,1)' });
          audio.levelUp();
          haptic('success');
          this.toast(`LEVEL UP! You're level ${r.levelAfter}`);
        }, 650);
      } else {
        bar.style.width = `${Math.round(r.levelProgress * 100)}%`;
      }
    }, 400);
  }

  // ───────────────────────────────────────── per-frame

  tick(dt: number): void {
    if (this.screen === 'menu') this.hero.draw(this.selectedSkin, dt);
  }
}
