export const ROOM_CAPACITY = 10;
export const CIGARETTE_DURATION_MS = 5 * 60 * 1000;
export const PRESENCE_TIMEOUT_MS = 45_000;
export const ROOM_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const TEXT_VISIBLE_MS = 14_000;
export const MAX_TEXT_LENGTH = 160;
export const MAX_NICKNAME_LENGTH = 16;
export const POLL_INTERVAL_MS = 900;
export type AvatarStyle = 'male' | 'female';
export type Participant = {
  id: string;
  nickname: string;
  seat: number;
  avatar: AvatarStyle;
  x: number;
  z: number;
  joinedAt: number;
  lastSeen: number;
  litAt: number | null;
  micOn: boolean;
  connectionId: string;
};
export type RoomSession = {
  roomId: string;
  participantId: string;
  token: string;
  connectionId: string;
  nickname: string;
};
export type RoomEvent = {
  seq: number;
  senderId: string;
  targetId: string | null;
  kind: 'chat' | 'caption' | 'signal';
  payload: string;
  createdAt: number;
};
export type SmokeMessage = {
  id: string;
  senderId: string;
  text: string;
  kind: 'chat' | 'caption';
  createdAt: number;
};
export type Signal = {
  epoch?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
export type RoomSnapshot = {
  participants: Participant[];
  events: RoomEvent[];
  serverNow: number;
  cursor: number;
  iceServers: RTCIceServer[];
};
export type RoomAction =
  | { type: 'connect' }
  | { type: 'light' }
  | { type: 'move'; x: number; z: number }
  | { type: 'mic'; enabled: boolean }
  | { type: 'leave' }
  | { type: 'chat' | 'caption'; text: string }
  | { type: 'signal'; targetId: string; signal: Signal };
