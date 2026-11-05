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

## ✧ Powers (pick one before each round)

Powers are role-style abilities inspired by the social-deduction genre. They exist to make players creative: bait, hide, trick, ambush. You get one power per round, chosen in the main menu, plus a cooldown button in the HUD (on desktop, **E** or right-click). Bots get random powers and use them in context.

| Power | Cooldown | Unlock | Effect | Creative plays |
|---|---|---|---|---|
| 🌀 **Wormhole** | 14s | Lv 1 | First press opens a portal where you stand. Press again within 10s to warp back to it. Everyone can see the portal. | Escape hatch, bait-and-vanish, flank warps, fake retreats |
| 🫧 **Bubble** | 18s | Lv 1 | 2.8s of immunity to bites and wraiths. Your moons can't bite while it's up. | Dive through a brawl, survive a Blood Moon pinch |
| 👥 **Phantom** | 16s | Lv 2 | Spawns a decoy with your name, skin and moons that keeps running. It's harmless and pops on any touch. Your own decoys show ghosted to you only. | Split a chase, make hunters and wraiths commit to the wrong target |
| 🕸️ **Snare** | 8s | Lv 4 | Drops a trap behind you (2 max). It's near-invisible to others: just a shimmer when they're right on top of it. A victim is slowed to 30% for 2.2s with frozen moons. | Lay traps on the route to a Starfall, snare a chaser, then turn and bite |
| 🎭 **Mimic** | 22s | Lv 6 | Take the nearest player's skin and name for 8s. Bots treat you as harmless. Biting someone breaks the disguise. | Walk right up to a target, impersonate the leader |
| 🌑 **Blackout** | 24s | Lv 9 | For 6s, everyone within 950u of you is nearly blind. You see everything, plus the zone outline. | Hunt in the dark, or cover an escape |

Clever plays (a Phantom fooling someone, a Snare catching someone, a Mimic bite) count as **tricks**. Tricks earn XP and feed a daily mission ("Pull off N power tricks").

## 🩸 The Blood Moon (horror event)

Every 2.5–3 minutes the game turns into something else.

1. **Warning (6s).** Three church-bell tolls, the sky drains to red, a giant Blood Moon rises behind the arena (if you look twice, it has a face), and the announcer stamps **BLOOD MOON**.
2. **The dark (34s).** The lights go out: you see only a flickering flashlight radius around your core. The music becomes a horror score with a detuned drone, a heartbeat kick, tritone bells, whispers and a bending whistle. Every other core turns **hollow**: dark veins, empty sockets with burning pinpoints, and a stitched grin full of teeth.
3. **Wraiths** crawl out of the dark 700–1000u from a player (humans are picked 60% of the time) and hunt. Their **red eyes are drawn above the darkness**, so you see them coming before you see them. They're slower than a small core but lunge when close, so surging is how you escape. Your moons can't kill them; a moon only **wards** one off (the wraith staggers and gets knocked back) and the moon shatters. Get caught with nothing between you and a wraith and you're **TAKEN**.
4. **Sunstones** (smug little suns, which glow through the dark and show on the minimap) let you fight back. Grab one to go **Radiant** for 9s: a golden aura and burning moons, wraiths turn pale and flee, and anything you touch is **banished** (+30 mass and a ring of gold dust).
5. **Dawn.** The survivors get +40 mass, the leftover wraiths dissolve into light, and the announcer says **DAWN**.

The heartbeat vignette and haptic pulse speed up as the nearest hunting wraith gets closer. Starfall is suspended so there's only one spectacle at a time. Daily missions include **Banish N wraiths** and **Survive a Blood Moon**.

### Kill-cams

Deaths during the Blood Moon (to a wraith, or to another player) cut to a full-screen **kill-cam**. Your own bites and banishes during the event get a short letterboxed one. There are six original variants, never the same twice in a row, each with its own sound sting and haptic hit:

| Variant | What happens |
|---|---|
| **The Maw** | Rows of teeth slam shut from the top and bottom of the screen; eyes open above the closed jaw. |
| **Tendrils** | Ink tendrils lash out, coil, squeeze the victim thin, and pop it. |
| **The Eye** | A bloodshot eye opens in the dark, its slit pupil narrows, and the victim cracks into falling slabs. |
| **Impaler** | A shadow spike (or a lance of the attacker's moons) skewers the victim, which hangs there and then slides off, dripping. |
| **Drag-Under** | Shadow hands rise from a pool, grab, and pull the victim under. Bubbles follow. |
| **Glitch** | RGB ghosting and tearing bands, then the victim shreds into strips. |

Each play also randomizes the side, camera tilt, accent color, tendril/hand count and timing, and the title (TAKEN / DEVOURED / CLAIMED / FEAST / BANISHED…). Offline, the simulation slows to a crawl while a kill-cam plays. Online the world keeps going, so the in-match kill-cams are short.

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
