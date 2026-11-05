# Moonbite — Game Design

> **Spin your moons. Bite their core.**

Moonbite is a real-time, drop-in/drop-out arena game in the same family as slither.io and paper.io: one huge shared map, one life, a live leaderboard, and the constant threat that someone bigger is just off-screen. The mechanic is new, though. You don't grow a tail or paint territory. You're a small planet ("core") with **moons orbiting you**, and those moons are your teeth.

## Core loop (10 seconds)

1. **Eat stardust** → mass goes up → you grow more moons and a wider orbit.
2. **Swing your moons into another core** → it's bitten (dies), and its mass explodes into dust you can scoop up.
3. **Keep your own core away from their moons** → if one touches you, you're dust too.

## The rules

| Thing | Rule |
|---|---|
| **Core** | Your body. Always moving. Bigger means slower, a bigger target, and more moons. |
| **Moons** | They orbit you automatically. If your moon touches an enemy **core**, you bite it. |
| **Moon vs moon** | Both moons **shatter**. They grow back over a few seconds. |
| **Surge** (hold) | +60% speed, and your orbit **swells to 1.7×** so you can snipe from range. It burns 2% of your mass per second and drops a dust trail. A wider orbit also opens **gaps** in your guard. |
| **Loose moons** | Some of a bitten core's moons break free. Touch one to **steal** it. You can go above your natural moon count for a while. |
| **Red rim** | Touch it and you're voided. While you're spawn-protected it's a bouncy wall instead. |
| **Starfall** | Every ~48s a zone gets marked on everyone's map, a countdown runs, then gold dust rains down. It pulls everyone into one fight. |
| **Spawn shield** | 3 seconds as a ghost: you can't be bitten and your moons can't bite. |

### Why it plays well

- **Risk/reward in one button.** Surge is how you attack, how you escape, and how you get yourself killed. A wide orbit has gaps a small, quick core can slip through.
- **Small beats big sometimes.** Small cores are faster and turn tighter, so a three-moon minnow can thread a big player's orbit. Big players need to keep their guard tight.
- **Comebacks.** Moons regenerate and loose moons can be stolen, so one lost clash isn't the end of a run.
- **Readable at a glance.** Every core shows its orbit ring, faces react (angry while surging, scared near a predator, `^ ^` after a bite), and the leader wears a crown on the field and on the minimap.

## Retention ("one more round")

- **Instant restart.** The death screen leads with a huge PLAY AGAIN. Enter/Space works on desktop.
- **Count-up rewards.** XP and coins tick up with coin sounds, and the level bar fills.
- **Progression.** Levels unlock skins, and coins buy premium skins. There are 16 hand-built skins, each with its own face and moon style (crater, ringed, gem, eyeball, ember, ice), plus an animated *Prism*.
- **Daily missions.** Three a day, picked by seeding with the date so every player gets the same set. Targets scale with level. There's also a day-streak counter.
- **Personal bests**, with a "NEW PERSONAL BEST!" stamp.
- **Moment-to-moment juice.** Pickup blips climb a pentatonic scale while you chain dust. Bites get hit-stop, screen shake, a flash and an announcer stamp (BITE → DOUBLE BITE → … → MOON LORD). On mobile, haptics fire for moon gains, clashes, bites and death.
- **Living menu.** The real arena runs behind the main menu, with bots fighting and the camera drifting between leaders.

## Bots

Bots run on the same input API as humans and use a utility AI that chooses between **farm**, **hunt** and **flee**, with hysteresis. Each bot gets a personality: aggression, caution, skill (reaction time and aim noise) and greed. The population is tiered: about 45% weak, 40% average, 15% "sharks". Hunters circle-strafe their target and time a surge for when the target sits inside their swollen orbit. Hunts have cooldowns so new players aren't swarmed. Use `npm run balance` to simulate an arena headlessly and print kill rates, lifetimes and the final leaderboard.

## Tuning

Every gameplay number lives in [`shared/constants.ts`](../shared/constants.ts). The formulas (radius, speed, moon count, orbit radius, regen time) are small pure functions, so a balance pass never touches the simulation logic.

## Art direction

"Sticker arcade": flat fills, a thick ink outline (`#120B1F`), one hard drop shadow, and a candy palette on a deep plum night sky with slow nebula parallax. There are no gradients on characters and no glassmorphism. The type pairing is **Lilita One** for display and numbers and **Fredoka** for body text. All audio is synthesized at runtime with WebAudio (SFX plus a small generative soundtrack whose intensity follows danger), so there are no audio assets to download.
