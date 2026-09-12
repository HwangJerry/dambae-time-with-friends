import { isWalkable, spawnPosition } from '../spatial';
import { env } from 'cloudflare:workers';
import {
  CIGARETTE_DURATION_MS,
  MAX_TEXT_LENGTH,
  PRESENCE_TIMEOUT_MS,
  ROOM_CAPACITY,
  ROOM_IDLE_TIMEOUT_MS,
  type Participant,
  type RoomEvent,
} from '../types';
import { RoomError, validateId, validateName, validateAvatar } from './http';
const EVENT_RETENTION_MS = 120_000;
const MESSAGE_RATE_MS = 350;
const PUBLIC_PARTICIPANT_COLUMNS =
  'id, nickname, seat, joined_at AS joinedAt, last_seen AS lastSeen, lit_at AS litAt, mic_on AS micOn, connection_id AS connectionId, x, z, avatar';
function database() {
  if (!env.DB) throw new RoomError(503, '흡연장 연결을 준비하고 있어요.');
  return env.DB;
}
async function tokenHash(token: string) {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
function newToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}
async function cleanup(db: D1Database, now: number) {
  await db.batch([
    db
      .prepare('DELETE FROM events WHERE created_at < ?')
      .bind(now - EVENT_RETENTION_MS),
    db.prepare('DELETE FROM rooms WHERE expires_at < ?').bind(now),
  ]);
}
export async function createRoom(name: unknown, avatarValue?: unknown) {
  const nickname = validateName(name);
  const avatar = validateAvatar(avatarValue);
  const db = database();
  const now = Date.now();
  await cleanup(db, now);
  const roomId = crypto.randomUUID(),
    participantId = crypto.randomUUID(),
    token = newToken(),
    connectionId = crypto.randomUUID();
  await db.batch([
    db
      .prepare('INSERT INTO rooms (id,created_at,expires_at) VALUES (?,?,?)')
      .bind(roomId, now, now + ROOM_IDLE_TIMEOUT_MS),
    db
      .prepare(
        'INSERT INTO participants (id,room_id,nickname,token_hash,connection_id,seat,joined_at,last_seen,x,z,avatar) VALUES (?,?,?,?,?,0,?,?,?,?,?)',
      )
      .bind(
        participantId,
        roomId,
        nickname,
        await tokenHash(token),
        connectionId,
        now,
        now,
        spawnPosition(0).x,
        spawnPosition(0).z,
        avatar,
      ),
  ]);
  return { roomId, participantId, token, nickname, connectionId };
}
export async function roomInfo(roomId: string) {
  validateId(roomId);
  const now = Date.now();
  const db = database();
  const room = await db
    .prepare('SELECT id FROM rooms WHERE id=? AND expires_at>?')
    .bind(roomId, now)
    .first();
  if (!room)
    throw new RoomError(404, '방이 닫혔거나 초대 링크가 올바르지 않아요.');
  const count = await db
    .prepare(
      'SELECT COUNT(*) AS count FROM participants WHERE room_id=? AND last_seen>?',
    )
    .bind(roomId, now - PRESENCE_TIMEOUT_MS)
    .first<{ count: number }>();
  return { count: count?.count ?? 0, capacity: ROOM_CAPACITY };
}
export async function joinRoom(
  roomId: string,
  name: unknown,
  avatarValue?: unknown,
) {
  validateId(roomId);
  const nickname = validateName(name);
  const avatar = validateAvatar(avatarValue);
  const db = database(),
    now = Date.now();
  await roomInfo(roomId);
  const participantId = crypto.randomUUID(),
    token = newToken(),
    connectionId = crypto.randomUUID();
  // A single INSERT SELECT chooses a free seat; the unique index serializes concurrent admissions.
  const result = await db.batch([
    db
      .prepare('DELETE FROM participants WHERE room_id=? AND last_seen<?')
      .bind(roomId, now - PRESENCE_TIMEOUT_MS),
    db
      .prepare(`INSERT INTO participants (id,room_id,nickname,token_hash,connection_id,seat,joined_at,last_seen,x,z,avatar)
    SELECT ?,?,?,?,?,slots.seat,?,?,(slots.seat % 5 - 2) * 1.5,2.3 + CAST(slots.seat / 5 AS INTEGER) * 1.5,? FROM (SELECT CAST(value AS INTEGER) AS seat FROM json_each('${JSON.stringify(Array.from({ length: ROOM_CAPACITY }, (_, i) => i))}')) slots
    WHERE NOT EXISTS (SELECT 1 FROM participants WHERE room_id=? AND seat=slots.seat)
    AND EXISTS (SELECT 1 FROM rooms WHERE id=? AND expires_at>?) ORDER BY slots.seat LIMIT 1`)
      .bind(
        participantId,
        roomId,
        nickname,
        await tokenHash(token),
        connectionId,
        now,
        now,
        avatar,
        roomId,
        roomId,
        now,
      ),
    db
      .prepare('UPDATE rooms SET expires_at=? WHERE id=? AND expires_at>?')
      .bind(now + ROOM_IDLE_TIMEOUT_MS, roomId, now),
  ]);
  if (!result[1].meta.changes)
    throw new RoomError(
      409,
      '10명이 모두 모였어요. 잠시 후 다시 들어와 주세요.',
    );
  return { roomId, participantId, token, nickname, connectionId };
}
export async function authenticate(request: Request, roomId: string) {
  validateId(roomId);
  const token = request.headers.get('Authorization')?.replace(/^Bearer /u, '');
  if (!token || token.length > 100)
    throw new RoomError(401, '다시 입장해 주세요.');
  const db = database();
  const member = await db
    .prepare(`SELECT participants.id,participants.last_seen AS lastSeen,participants.connection_id AS connectionId FROM participants
   JOIN rooms ON rooms.id=participants.room_id WHERE participants.room_id=? AND token_hash=? AND rooms.expires_at>?`)
    .bind(roomId, await tokenHash(token), Date.now())
    .first<{ id: string; lastSeen: number; connectionId: string }>();
  if (!member)
    throw new RoomError(401, '연결이 종료됐어요. 다시 입장해 주세요.');
  // Old credentials cannot reclaim a seat occupied by another participant.
  return { db, member };
}
export async function syncRoom(request: Request, roomId: string) {
  const { db, member } = await authenticate(request, roomId);
  if (request.headers.get('X-Room-Connection') !== member.connectionId)
    throw new RoomError(401, '다른 창에서 다시 입장했어요.');
  const now = Date.now();
  const afterText = new URL(request.url).searchParams.get('after') ?? '0';
  const after = Number(afterText);
  if (!Number.isSafeInteger(after) || after < 0)
    throw new RoomError(400, '연결 상태를 다시 확인해 주세요.');
  await db.batch([
    db
      .prepare(
        'UPDATE participants SET last_seen=?, mic_on=CASE WHEN last_seen<? THEN 0 ELSE mic_on END WHERE id=?',
      )
      .bind(now, now - PRESENCE_TIMEOUT_MS, member.id),
    db
      .prepare('UPDATE rooms SET expires_at=? WHERE id=?')
      .bind(now + ROOM_IDLE_TIMEOUT_MS, roomId),
    db
      .prepare('DELETE FROM events WHERE room_id=? AND created_at<?')
      .bind(roomId, now - EVENT_RETENTION_MS),
  ]);
  const results = await db.batch([
    db
      .prepare(
        `SELECT ${PUBLIC_PARTICIPANT_COLUMNS} FROM participants WHERE room_id=? AND last_seen>? ORDER BY seat`,
      )
      .bind(roomId, now - PRESENCE_TIMEOUT_MS),
    db
      .prepare(`SELECT seq,sender_id AS senderId,target_id AS targetId,kind,payload,created_at AS createdAt FROM events
   WHERE room_id=? AND seq>? AND (target_id IS NULL OR target_id=?) ORDER BY seq LIMIT 200`)
      .bind(roomId, after, member.id),
  ]);
  const participants = (results[0].results as unknown as Participant[]).map(
    (p) => ({
      ...p,
      micOn: Boolean(p.micOn),
    }),
  );
  const events = results[1].results as unknown as RoomEvent[];
  const iceServers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  ];
  // Optional TURN REST credentials are short-lived and minted only for authenticated room members.
  const runtime = env as unknown as {
    TURN_URLS?: string;
    TURN_SHARED_SECRET?: string;
  };
  if (runtime.TURN_URLS && runtime.TURN_SHARED_SECRET) {
    const username = `${Math.floor(now / 600_000) * 600 + 3600}:${member.id}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(runtime.TURN_SHARED_SECRET),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username)),
    );
    iceServers.push({
      urls: runtime.TURN_URLS.split(',').map((u) => u.trim()),
      username,
      credential: btoa(String.fromCharCode(...signature)),
    });
  }
  return {
    participants,
    events,
    serverNow: now,
    cursor: events.at(-1)?.seq ?? after,
    iceServers,
  };
}
export async function roomAction(
  request: Request,
  roomId: string,
  body: Record<string, unknown>,
) {
  const { db, member } = await authenticate(request, roomId);
  const now = Date.now();
  if (body.type !== 'connect' && body.connectionId !== member.connectionId)
    throw new RoomError(401, '다른 창에서 다시 입장했어요.');
  switch (body.type) {
    case 'connect': {
      if (typeof body.connectionId !== 'string')
        throw new RoomError(400, '연결을 확인해 주세요.');
      validateId(body.connectionId);
      if (body.connectionId !== member.connectionId)
        await db.batch([
          db
            .prepare(
              "DELETE FROM events WHERE room_id=? AND kind='signal' AND (sender_id=? OR target_id=?)",
            )
            .bind(roomId, member.id, member.id),
          db
            .prepare(
              'UPDATE participants SET connection_id=?,mic_on=0,last_seen=? WHERE id=?',
            )
            .bind(body.connectionId, now, member.id),
        ]);
      return { ok: true };
    }
    case 'leave':
      await db.batch([
        db.prepare('DELETE FROM participants WHERE id=?').bind(member.id),
        db
          .prepare('UPDATE rooms SET expires_at=? WHERE id=?')
          .bind(now + ROOM_IDLE_TIMEOUT_MS, roomId),
      ]);
      return { ok: true };
    case 'light': {
      const change = await db
        .prepare(
          'UPDATE participants SET lit_at=? WHERE id=? AND (lit_at IS NULL OR lit_at<=?)',
        )
        .bind(now, member.id, now - CIGARETTE_DURATION_MS)
        .run();
      if (!change.meta.changes)
        throw new RoomError(409, '아직 타고 있는 담배가 있어요.');
      return { ok: true, litAt: now };
    }
    case 'move': {
      if (
        typeof body.x !== 'number' ||
        typeof body.z !== 'number' ||
        !isWalkable({ x: body.x, z: body.z })
      )
        throw new RoomError(400, '이동할 수 없는 위치예요.');
      await db
        .prepare('UPDATE participants SET x=?,z=? WHERE id=?')
        .bind(body.x, body.z, member.id)
        .run();
      return { ok: true };
    }
    case 'mic':
      if (typeof body.enabled !== 'boolean')
        throw new RoomError(400, '마이크 상태를 확인해 주세요.');
      await db
        .prepare('UPDATE participants SET mic_on=? WHERE id=?')
        .bind(body.enabled ? 1 : 0, member.id)
        .run();
      return { ok: true };
    case 'chat':
    case 'caption': {
      if (
        typeof body.text !== 'string' ||
        !body.text.trim() ||
        body.text.length > MAX_TEXT_LENGTH
      )
        throw new RoomError(
          400,
          `말은 ${MAX_TEXT_LENGTH}자 이내로 보내 주세요.`,
        );
      const change = await db
        .prepare(
          'UPDATE participants SET last_message_at=? WHERE id=? AND last_message_at<=?',
        )
        .bind(now, member.id, now - MESSAGE_RATE_MS)
        .run();
      if (!change.meta.changes)
        throw new RoomError(429, '한 박자 쉬고 다시 보내 주세요.');
      const payload = body.text.trim();
      const inserted = await db
        .prepare(
          'INSERT INTO events(room_id,sender_id,kind,payload,created_at) VALUES(?,?,?,?,?) RETURNING seq',
        )
        .bind(roomId, member.id, body.type, payload, now)
        .first<{ seq: number }>();
      return {
        ok: true,
        event: {
          seq: inserted!.seq,
          senderId: member.id,
          targetId: null,
          kind: body.type,
          payload,
          createdAt: now,
        },
      };
    }
    case 'signal': {
      if (typeof body.targetId !== 'string' || body.targetId === member.id)
        throw new RoomError(400, '대화 상대를 확인해 주세요.');
      const target = await db
        .prepare(
          'SELECT id FROM participants WHERE id=? AND room_id=? AND last_seen>?',
        )
        .bind(body.targetId, roomId, now - PRESENCE_TIMEOUT_MS)
        .first();
      if (!target) throw new RoomError(404, '친구가 자리를 떠났어요.');
      const signal = body.signal as
        | {
            description?: { type?: unknown; sdp?: unknown };
            candidate?: unknown;
          }
        | undefined;
      if (
        !signal ||
        typeof signal !== 'object' ||
        (!signal.description && !signal.candidate)
      )
        throw new RoomError(400, '음성 연결 요청을 확인해 주세요.');
      if (
        signal.description &&
        (!['offer', 'answer'].includes(String(signal.description.type)) ||
          typeof signal.description.sdp !== 'string')
      )
        throw new RoomError(400, '음성 연결 요청을 확인해 주세요.');
      const payload = JSON.stringify({ ...signal, epoch: member.connectionId });
      if (payload.length > 24_000)
        throw new RoomError(413, '음성 연결 요청이 너무 커요.');
      // Cap each member's signaling backlog to prevent unbounded event storage.
      const count = await db
        .prepare(
          "SELECT COUNT(*) AS count FROM events WHERE room_id=? AND sender_id=? AND kind='signal' AND created_at>?",
        )
        .bind(roomId, member.id, now - 10_000)
        .first<{ count: number }>();
      if ((count?.count ?? 0) > 150)
        throw new RoomError(429, '음성 연결을 잠시 후 다시 시도해 주세요.');
      await db
        .prepare(
          'INSERT INTO events(room_id,sender_id,target_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)',
        )
        .bind(roomId, member.id, body.targetId, 'signal', payload, now)
        .run();
      return { ok: true };
    }
    default:
      throw new RoomError(400, '요청을 확인해 주세요.');
  }
}
