import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable(
  'rooms',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('idx_rooms_expires').on(table.expiresAt)],
);
export const participants = sqliteTable(
  'participants',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    avatar: text('avatar').notNull().default('male'),
    connectionId: text('connection_id').notNull().default(''),
    tokenHash: text('token_hash').notNull(),
    seat: integer('seat').notNull(),
    x: real('x').notNull().default(0),
    z: real('z').notNull().default(2.3),
    joinedAt: integer('joined_at').notNull(),
    lastSeen: integer('last_seen').notNull(),
    litAt: integer('lit_at'),
    micOn: integer('mic_on').notNull().default(0),
    lastMessageAt: integer('last_message_at').notNull().default(0),
  },
  (table) => [
    uniqueIndex('idx_participants_room_seat').on(table.roomId, table.seat),
  ],
);
export const events = sqliteTable(
  'events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    senderId: text('sender_id').notNull(),
    targetId: text('target_id'),
    kind: text('kind').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_events_room_seq').on(table.roomId, table.seq),
    index('idx_events_created').on(table.createdAt),
  ],
);
