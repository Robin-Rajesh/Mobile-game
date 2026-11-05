import { SURGE_MIN_MASS } from '../../../shared/constants';
import { powerDef } from '../../../shared/powers';
import { IS_TOUCH } from '../config';
import type { Input } from '../input/Input';
import type { ProfileStore } from '../meta/profile';
import type { UI } from '../ui/UI';
import type { Round } from './round';
import type { ViewCore } from './session';

/** First-run coaching: one non-blocking hint at a time, advanced by doing the thing. */
export class Tutorial {
  static readonly STEPS = 4;

  constructor(
    private profile: ProfileStore,
    private ui: UI,
    private input: Input,
  ) {}

  update(me: ViewCore, round: Round, dt: number): void {
    if (performance.now() < round.bloodHintUntil) {
      this.ui.hint('Wraiths can’t be bitten — your moons only <b>slow</b> them. Grab a <b>☀ sunstone</b> and turn the hunt around');
      return;
    }
    const p = this.profile.data;
    if (p.tutorialSteps >= Tutorial.STEPS) {
      this.ui.hint(null);
      return;
    }
    round.tutorialClock += dt;
    const t = round.tutorialClock;
    switch (p.tutorialSteps) {
      case 0:
        this.ui.hint(`${IS_TOUCH ? 'Drag your <b>left thumb</b> to steer' : 'Move your <b>mouse</b> to steer'} · eat <b>stardust</b> to grow`);
        if (this.input.steered && t > 3) this.advance(round);
        break;
      case 1:
        this.ui.hint('Your <b>moons</b> are your teeth — swing them into another core to <b>BITE</b> it');
        if (t > 7) this.advance(round);
        break;
      case 2:
        if (me.mass > SURGE_MIN_MASS + 4) this.ui.hint(IS_TOUCH ? '<b>Hold the right side</b> to SURGE — faster, wider orbit' : '<b>Hold click</b> or <b>Space</b> to SURGE — faster, wider orbit');
        else this.ui.hint('Keep eating — <b>surge</b> unlocks at 30 mass');
        if (this.input.surgedOnce && me.mass > SURGE_MIN_MASS) this.advance(round);
        break;
      case 3: {
        const pd = powerDef(p.power);
        this.ui.hint(`${IS_TOUCH ? 'Tap the <b>power button</b>' : 'Press <b>E</b> / right-click'} to use <b>${pd.name}</b> — ${pd.blurb.toLowerCase()}`);
        if (round.power.cdUntil > 0 || round.power.armed) this.advance(round);
        break;
      }
    }
  }

  private advance(round: Round): void {
    this.profile.data.tutorialSteps++;
    this.profile.save();
    round.tutorialClock = 0;
    this.ui.hint(null);
  }
}
