# Moonbite architecture

## The one rule

**The simulation is the single source of truth, and it doesn't know rendering exists.**
`shared/` contains the whole game: rules, bots, Blood Moon and powers. It's deterministic TypeScript with no DOM, so the browser (offline mode) and the server (online rooms) run the *same* code. Everything in `client/` either feeds input in or turns output into pixels, sound and buzzes.

```
                 ┌──────────────────────── shared/ (pure, no DOM) ────────────────────────┐
  input ───────► │ World.step(dt)                                                        │
 (angle, surge,  │   ├─ BotBrain.think()      bots write input exactly like a human      │
  power press)   │   ├─ Powers.step/use()     cooldowns, phantoms, snares, blackouts     │
                 │   ├─ combat / dust / rim   resolveCombat, eatDust                     │
                 │   └─ BloodMoon.step()      phases, wraiths, sunstones                 │
                 │ output: entities + events[] + addedDust[] + removedDust[]             │
                 └───────────────┬────────────────────────────────────┬──────────────────┘
                                 │ offline: LocalSession              │ online: server/Room
                                 │ (World runs in the browser)        │ (World runs at 30 Hz,
                                 │                                    │  snapshots at 15 Hz)
                                 ▼                                    ▼
                         ┌───────────────── client Session interface ─────────────────┐
                         │ cores, dust, wraiths, traps, …  +  drain(events, dust)     │
                         │ LocalSession = direct     NetSession = interpolated +      │
                         │                           own-core prediction              │
                         └───────────────┬────────────────────────────────────────────┘
                                         ▼
  Game (flow + frame loop) ──► feedback/*   events → effects, audio, haptics, UI, stats
                           ──► PlayerSync   player state → music tension, cooldown UI, fear
                           ──► HudSync      leaderboard, minimap, timers
                           ──► CameraDirector, Tutorial
                           ──► Renderer ──► layers/ (BloodMoon, Darkness, Powers) + Cinematic
```

## Layers and what may import what

| Layer | Folder | May import | Must never |
|---|---|---|---|
| Simulation | `shared/` | only `shared/` | touch DOM, `window`, timers, the client or the server |
| Server | `server/` | `shared/`, `ws`, Node | import client code |
| Session | `client/src/game/*Session.ts` | `shared/` | render or play sound |
| Orchestration | `client/src/game/` | everything client | contain drawing code |
| Rendering | `client/src/render/` | `shared/` read-only types and constants | mutate the simulation |
| UI | `client/src/ui/` | `meta/`, `shared/` definitions | reach into the simulation |

`tests/architecture.test.ts` enforces the import rules and checks that **every event the simulation emits has a client feedback handler**. If you add an event and forget its feedback, CI fails.

## Module map

### `shared/`
| File | Responsibility |
|---|---|
| `world.ts` | The `World`: cores, moons, dust grid, combat, rim, starfall, bot respawn. `players()` yields real, living participants (no phantoms). |
| `powers.ts` | Power definitions and **all** power rules, including every phantom (decoy) rule. The World asks `Powers` instead of knowing decoy internals. |
| `bloodmoon.ts` | Blood Moon phases, wraith AI, sunstones, radiance, banishing. |
| `bot.ts` | Utility-AI bots. They write `core.input` like a human client would. |
| `constants.ts` | Every tuning number and growth formula. Balance passes touch only this file and `powers.ts`. |
| `protocol.ts` / `codec.ts` | Wire messages, validation, name sanitizing, compact encoding. |

### `client/src/game/`
| File | Responsibility |
|---|---|
| `Game.ts` | Match flow (menu → play → death → again), the frame loop, and building the feedback context. Nothing else. |
| `round.ts` | All per-life mutable state, recreated on every spawn so nothing leaks between lives. |
| `feedback/` | **Event → feedback**, one module per feature (`combat`, `bloodmoon`, `powers`), merged in `index.ts`. Handlers are typed per event. |
| `PlayerSync.ts` | Feedback derived from player *state* each frame (not events). |
| `HudSync.ts`, `CameraDirector.ts`, `Tutorial.ts` | One job each. |
| `LocalSession.ts` / `NetSession.ts` | The two implementations of `Session`. |

### `client/src/render/`
| File | Responsibility |
|---|---|
| `Renderer.ts` | Camera, shake, base world (background, arena, dust, cores, moons), and **sequencing** of the layers. |
| `layers/host.ts` | The `LayerHost` contract: the canvas, camera and effects a layer may use. |
| `layers/BloodMoonLayer.ts` | Blood sky, rising moon, sunstones, wraiths, heartbeat overlay. |
| `layers/DarknessLayer.ts` | Flashlight darkness, shared by the Blood Moon and the Blackout power. |
| `layers/PowersLayer.ts` | Wormholes, snares, blackout zones, per-core power decorations. |
| `Cinematic.ts` | Kill-cams. |
| `art.ts`, `effects.ts` | Pure drawing functions and the pooled particle system. |

## Recipes

### Add a new power
1. `shared/powers.ts`: add it to `POWERS`, implement it in `Powers.use()`, and put any per-tick logic in `Powers.step()`. Emit events for anything the player should notice.
2. If it adds new world objects, add them to the snapshot in `server/room.ts` and to `Session` (both implementations).
3. `client/src/game/feedback/powers.ts`: add handlers for the new events. `tests/architecture.test.ts` fails until you do.
4. `client/src/render/layers/PowersLayer.ts`: add the visuals.
5. `client/src/ui/powerIcons.ts`: add the icon.
6. Teach bots in `BotBrain.usePower()` and add a test in `tests/powers.test.ts`.

### Add a new world event (like Blood Moon)
Create `shared/<event>.ts` with a class that `World.step()` calls. Add a client feedback module under `feedback/`, a render layer under `render/layers/`, and a test file. Don't add branches to existing feature files.

### Change balance
Use `shared/constants.ts` and `shared/powers.ts`, then run `npm run balance` to see kill rates, lifetimes and event counts across a simulated bot arena.

## Known debt (honest list)
- `Renderer.drawCores` is still about 200 lines. The next step would be a `CoreLayer` that owns per-core visual state (`CoreVisual`).
- `UI.ts` handles the menu, HUD, death screen and modals in one class. It should split into one class per screen as the UI grows.
- Power unlocks and progression are client-side (`localStorage`). An online game with a real economy needs accounts and server-side verification.
- The protocol is JSON. It's fine at current scale; move to a binary codec if bandwidth becomes a cost.
