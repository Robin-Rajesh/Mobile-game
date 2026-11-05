import { audio } from '../audio/Audio';
import { haptic } from '../platform/haptics';
import type { UI } from '../ui/UI';
import type { Round } from './round';
import type { BoardEntry, Session, ViewCore } from './session';

/** Pushes match state into the DOM HUD at sensible rates (DOM writes are not free). */
export class HudSync {
  private boardTimer = 0;
  private miniTimer = 0;

  constructor(private ui: UI) {}

  update(session: Session, me: ViewCore | undefined, round: Round, board: BoardEntry[], crownId: number | null, dt: number): void {
    const ui = this.ui;
    if (me) ui.updateScore(me.mass, me.moons.length, session.rankOf(me.id));

    if (me && crownId === me.id && !round.hadCrown && session.population() > 3) {
      round.hadCrown = true;
      ui.announce("YOU'RE #1", 'everyone can see your crown', 'mint');
      haptic('success');
      audio.levelUp();
    }

    this.boardTimer -= dt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.5;
      const meInfo = me ? { mass: me.mass, rank: session.rankOf(me.id), name: me.name } : null;
      ui.updateBoard(board, session.meId, meInfo, session.population());
    }
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 1 / 15;
      ui.minimap.draw(session, session.meId, crownId, 1 / 15);
    }
    const sf = session.starfall;
    const bl = session.blood;
    ui.bloodAlert(bl.phase, bl.in, me && me.radiant > 0 ? Math.max(0, (round.radiantUntil - performance.now()) / 1000) : 0);
    ui.starfallAlert(bl.phase === 'calm' && sf && sf.in > 0 ? sf.in : null);
  }
}
