import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { ROOM_TARGET_POPULATION } from '../shared/constants';
import { PROTOCOL_VERSION } from '../shared/protocol';
import type { ServerMsg } from '../shared/protocol';
import { Room } from '../server/room';
import type { Client } from '../server/room';

function fakeClient(): { client: Client; inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  const ws = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: string) => inbox.push(JSON.parse(data) as ServerMsg),
    close: () => undefined,
  } as unknown as WebSocket;
  return { client: { ws, name: '', skin: 0, coreId: null, joined: false, msgBudget: 40, lastSeen: Date.now() }, inbox };
}

const rooms: Room[] = [];
afterEach(() => {
  for (const r of rooms) r.stop();
  rooms.length = 0;
});

describe('Room', () => {
  it('fills with bots, welcomes a player, streams snapshots and applies input', async () => {
    const room = new Room('test');
    rooms.push(room);
    expect(room.world.bots.size).toBe(ROOM_TARGET_POPULATION);

    const { client, inbox } = fakeClient();
    room.add(client);
    room.handle(client, { t: 'join', v: PROTOCOL_VERSION, name: '  Robin\u0000 ', skin: 4 });
    const welcome = inbox.find((m) => m.t === 'welcome');
    expect(welcome && welcome.t === 'welcome' && welcome.dust.length).toBeGreaterThan(100);
    expect(client.coreId).not.toBeNull();
    const core = room.world.cores.get(client.coreId!)!;
    expect(core.name).toBe('Robin');
    expect(core.skin).toBe(4);
    // a bot made room for the human
    expect(room.world.bots.size + room.world.pendingBotRespawns).toBe(ROOM_TARGET_POPULATION - 1);

    room.handle(client, { t: 'in', a: 1.5, s: 0 });
    expect(core.input.angle).toBe(1.5);

    room.start();
    await new Promise((r) => setTimeout(r, 300));
    const snaps = inbox.filter((m) => m.t === 's');
    expect(snaps.length).toBeGreaterThan(2);
    const last = snaps[snaps.length - 1];
    expect(last.t === 's' && last.c.some((c) => c[0] === client.coreId)).toBe(true);
    // Blood Moon state rides along in every snapshot
    room.world.bloodMoon.trigger(0.05);
    await new Promise((r) => setTimeout(r, 250));
    const s2 = inbox.filter((m) => m.t === 's').pop()!;
    expect(s2.t === 's' && s2.bm && s2.bm.p).toBeTruthy();
    expect(s2.t === 's' && Array.isArray(s2.wr) && Array.isArray(s2.ss)).toBe(true);

    room.remove(client);
    expect(room.world.cores.has(core.id)).toBe(false);
  });

  it('rejects outdated clients and unknown skins', () => {
    const room = new Room('t2');
    rooms.push(room);
    const old = fakeClient();
    room.add(old.client);
    room.handle(old.client, { t: 'join', v: PROTOCOL_VERSION - 1, name: 'x', skin: 0 });
    expect(old.client.coreId).toBeNull();
    expect(old.inbox[0]).toEqual({ t: 'error', msg: 'outdated' });

    const sneaky = fakeClient();
    room.add(sneaky.client);
    room.handle(sneaky.client, { t: 'join', v: PROTOCOL_VERSION, name: '', skin: 999 });
    const c = room.world.cores.get(sneaky.client.coreId!)!;
    expect(c.skin).toBe(0);
    expect(c.name).toBe('moonling');
  });

  it('rate-limits message floods', () => {
    const { client } = fakeClient();
    let allowed = 0;
    for (let i = 0; i < 500; i++) if (Room.allowMessage(client)) allowed++;
    expect(allowed).toBeLessThan(100);
  });
});
