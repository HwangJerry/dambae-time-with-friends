import type { RoomAction, RoomEvent, RoomSession } from './types';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requestJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(12_000),
    headers,
    cache: 'no-store',
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error ?? '연결을 다시 확인해 주세요.',
    );
  return data;
}
export function sendRoomAction(session: RoomSession, action: RoomAction) {
  return requestJson<{ ok: true; litAt?: number; event?: RoomEvent }>(
    `/api/rooms/${session.roomId}/action`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ ...action, connectionId: session.connectionId }),
    },
  );
}
export function sessionKey(roomId: string) {
  return `smoking-room-session:${roomId}`;
}
