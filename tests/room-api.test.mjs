import assert from 'node:assert/strict';
import { test } from 'node:test';
const origin = process.env.TEST_ORIGIN ?? 'http://localhost:3000';
const sessions = [];
async function call(path, { token, connectionId, ...options } = {}) {
  const response = await fetch(`${origin}/api/rooms${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(connectionId ? { 'X-Room-Connection': connectionId } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
async function create(nickname = '테스트 친구') {
  const result = await call('', { method: 'POST', body: { nickname } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  sessions.push(result.body);
  return result.body;
}
async function action(session, body) {
  return call(`/${session.roomId}/action`, {
    method: 'POST',
    token: session.token,
    body: { ...body, connectionId: session.connectionId },
  });
}
async function sync(session) {
  return call(`/${session.roomId}/sync`, {
    token: session.token,
    connectionId: session.connectionId,
  });
}
test('friend-room admission, privacy, lifecycle and messaging', async (t) => {
  try {
    await t.test(
      'invalid nickname and malformed room are rejected',
      async () => {
        assert.equal(
          (await call('', { method: 'POST', body: { nickname: '  ' } })).status,
          400,
        );
        assert.equal(
          (
            await call('', {
              method: 'POST',
              body: { nickname: 'x'.repeat(17) },
            })
          ).status,
          400,
        );
        assert.equal((await call('/invalid-id')).status, 404);
      },
    );
    assert.equal((await call('', { method: 'POST', body: { nickname: '검증', avatar: 'invalid' } })).status, 400);
    const owner = await create();
    await t.test(
      'anonymous snapshot is rejected, owner receives a seat without credentials leaking',
      async () => {
        assert.equal((await call(`/${owner.roomId}/sync`)).status, 401);
        const snapshot = await sync(owner);
        assert.equal(snapshot.status, 200);
        assert.equal(snapshot.body.participants.length, 1);
        assert.equal(snapshot.body.participants[0].micOn, false);
        assert.equal(snapshot.body.participants[0].litAt, null);
        assert(!JSON.stringify(snapshot.body).includes(owner.token));
        assert(!JSON.stringify(snapshot.body).includes('tokenHash'));
      },
    );
    await t.test('concurrent joins cannot exceed ten seats', async () => {
      const attempts = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          call(`/${owner.roomId}/join`, {
            method: 'POST',
            body: { nickname: `친구${i}`, avatar: i % 2 ? 'female' : 'male' },
          }),
        ),
      );
      const joined = attempts.filter((r) => r.status === 201);
      assert.equal(joined.length, 9);
      assert.equal(attempts.filter((r) => r.status === 409).length, 3);
      sessions.push(...joined.map((r) => r.body));
      const snapshot = await sync(owner);
      assert.equal(snapshot.body.participants.length, 10);
      assert(snapshot.body.participants.some(p => p.avatar === 'female'));
      assert(snapshot.body.participants.some(p => p.avatar === 'male'));
      assert.equal(
        new Set(snapshot.body.participants.map((p) => p.seat)).size,
        10,
      );
    });
    const friend = sessions.find(
      (s) =>
        s.roomId === owner.roomId && s.participantId !== owner.participantId,
    );
    await t.test('positions are shared, bounded and isolated', async () => {
      assert.equal(
        (await action(owner, { type: 'move', x: 6, z: 5 })).status,
        200,
      );
      const observed = (await sync(friend)).body.participants.find(
        (p) => p.id === owner.participantId,
      );
      assert.equal(observed.x, 6);
      assert.equal(observed.z, 5);
      assert.equal(
        (await action(owner, { type: 'move', x: 100, z: 0 })).status,
        400,
      );
      assert.equal(
        (await action(owner, { type: 'move', x: 0, z: -2 })).status,
        400,
      );
      assert.equal(
        (await action(owner, { type: 'move', x: '0', z: 2 })).status,
        400,
      );
      const unchanged = (await sync(owner)).body.participants.find(
        (p) => p.id === owner.participantId,
      );
      assert.equal(unchanged.x, 6);
    });
    const other = await create('다른 방');
    await t.test(
      'chat is delivered only to the same room and does not accept forged credentials',
      async () => {
        const sent = await action(owner, {
          type: 'chat',
          text: '연기에 띄운 테스트',
        });
        assert.equal(sent.status, 200);
        assert(
          (await sync(friend)).body.events.some(
            (e) => e.kind === 'chat' && e.payload === '연기에 띄운 테스트',
          ),
        );
        assert(
          !(await sync(other)).body.events.some(
            (e) => e.payload === '연기에 띄운 테스트',
          ),
        );
        assert.equal(
          (await call(`/${other.roomId}/sync`, { token: owner.token })).status,
          401,
        );
        assert.equal(
          (
            await call(`/${owner.roomId}/action`, {
              method: 'POST',
              token: 'forged',
              body: { type: 'chat', text: 'no' },
            })
          ).status,
          401,
        );
        assert.equal(
          (await action(owner, { type: 'chat', text: 'x'.repeat(161) })).status,
          400,
        );
      },
    );
    await t.test(
      'caption and targeted signaling routes are separated',
      async () => {
        const caption = await action(friend, {
          type: 'caption',
          text: '목소리가 글자로',
        });
        assert.equal(caption.status, 200);
        assert(
          (await sync(owner)).body.events.some((e) => e.kind === 'caption'),
        );
        assert.equal(
          (
            await action(owner, {
              type: 'signal',
              targetId: other.participantId,
              signal: { description: { type: 'offer', sdp: 'test' } },
            })
          ).status,
          404,
        );
        const signal = await action(owner, {
          type: 'signal',
          targetId: friend.participantId,
          signal: { description: { type: 'offer', sdp: 'test' } },
        });
        assert.equal(signal.status, 200);
        assert(
          (await sync(friend)).body.events.some((e) => e.kind === 'signal'),
        );
        assert(
          !(await sync(owner)).body.events.some((e) => e.kind === 'signal'),
        );
      },
    );
    await t.test(
      'burn time is authoritative and cannot be restarted while burning',
      async () => {
        const lit = await action(owner, { type: 'light' });
        assert.equal(lit.status, 200);
        assert(Number.isFinite(lit.body.litAt));
        assert.equal((await action(owner, { type: 'light' })).status, 409);
        const snapshot = (await sync(friend)).body;
        assert.equal(
          snapshot.participants.find((p) => p.id === owner.participantId).litAt,
          lit.body.litAt,
        );
        assert.equal(
          snapshot.participants.find((p) => p.id === friend.participantId)
            .litAt,
          null,
        );
      },
    );
    await t.test(
      'refresh rotates the voice connection without duplicating the seat',
      async () => {
        const before = (await sync(owner)).body;
        const next = { ...owner, connectionId: crypto.randomUUID() };
        assert.equal((await action(next, { type: 'connect' })).status, 200);
        assert.equal((await sync(owner)).status, 401);
        assert.equal(
          (await action(owner, { type: 'mic', enabled: true })).status,
          401,
        );
        const after = (await sync(next)).body;
        assert.equal(after.participants.length, before.participants.length);
        assert.equal(
          after.participants.find((p) => p.id === owner.participantId).litAt,
          before.participants.find((p) => p.id === owner.participantId).litAt,
        );
        assert.equal(
          after.participants.find((p) => p.id === owner.participantId)
            .connectionId,
          next.connectionId,
        );
        assert.equal(
          after.participants.find((p) => p.id === owner.participantId).micOn,
          false,
        );
        assert(
          !(await sync(friend)).body.events.some(
            (e) => e.kind === 'signal' && e.senderId === owner.participantId,
          ),
        );
        owner.connectionId = next.connectionId;
      },
    );
    await t.test(
      'microphone state validates boolean; leaving revokes membership and frees a seat',
      async () => {
        assert.equal(
          (await action(friend, { type: 'mic', enabled: 'yes' })).status,
          400,
        );
        assert.equal(
          (await action(friend, { type: 'mic', enabled: true })).status,
          200,
        );
        assert.equal(
          (await sync(owner)).body.participants.find(
            (p) => p.id === friend.participantId,
          ).micOn,
          true,
        );
        assert.equal((await action(friend, { type: 'leave' })).status, 200);
        assert.equal((await sync(friend)).status, 401);
        assert.equal((await sync(owner)).body.participants.length, 9);
        const joined = await call(`/${owner.roomId}/join`, {
          method: 'POST',
          body: { nickname: '새 친구' },
        });
        assert.equal(joined.status, 201);
        sessions.push(joined.body);
      },
    );
  } finally {
    await Promise.all(sessions.map((s) => action(s, { type: 'leave' })));
  }
});
