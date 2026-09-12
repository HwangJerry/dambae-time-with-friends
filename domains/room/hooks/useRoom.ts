'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { POSITION_POLL_MS } from '../spatial';
import { ApiError, requestJson, sendRoomAction } from '../api';
import {
  TEXT_VISIBLE_MS,
  type Participant,
  type RoomEvent,
  type RoomSession,
  type RoomSnapshot,
  type Signal,
  type SmokeMessage,
} from '../types';
export function useRoom(
  session: RoomSession,
  signalReceiver: RefObject<
    ((sender: string, signal: Signal) => Promise<void>) | null
  >,
  onExpired: () => void,
) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<SmokeMessage[]>([]);
  const [connection, setConnection] = useState<
    'connecting' | 'connected' | 'reconnecting'
  >('connecting');
  const [clockOffset, setClockOffset] = useState(0);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const seen = useRef(new Set<number>());
  const expires = useRef(onExpired);
  useEffect(() => {
    expires.current = onExpired;
  }, [onExpired]);
  const acceptEvent = useCallback((event: RoomEvent) => {
    if (seen.current.has(event.seq)) return;
    seen.current.add(event.seq);
    if (seen.current.size > 600)
      seen.current = new Set([...seen.current].slice(-300));
    if (event.kind !== 'signal')
      setMessages((previous) =>
        [
          ...previous.filter((m) => m.id !== String(event.seq)),
          {
            id: String(event.seq),
            senderId: event.senderId,
            text: event.payload,
            kind: event.kind as 'chat' | 'caption',
            createdAt: event.createdAt,
          },
        ].slice(-48),
      );
  }, []);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>,
      cursor = 0;
    let connected = false;
    const controller = new AbortController();
    async function poll() {
      try {
        if (!connected) {
          await sendRoomAction(session, { type: 'connect' });
          connected = true;
        }
        if (!alive) return;
        const snapshot = await requestJson<RoomSnapshot>(
          `/api/rooms/${session.roomId}/sync?after=${cursor}`,
          {
            headers: {
              Authorization: `Bearer ${session.token}`,
              'X-Room-Connection': session.connectionId,
            },
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(12_000),
            ]),
          },
        );
        if (!alive) return;
        setClockOffset(snapshot.serverNow - Date.now());
        setParticipants(snapshot.participants);
        setConnection('connected');
        setIceServers((old) =>
          JSON.stringify(old) === JSON.stringify(snapshot.iceServers)
            ? old
            : snapshot.iceServers,
        );
        for (const event of snapshot.events) {
          if (event.kind === 'signal') {
            if (!seen.current.has(event.seq) && signalReceiver.current) {
              const signal = JSON.parse(event.payload) as Signal;
              const currentSender = snapshot.participants.find(
                (p) => p.id === event.senderId,
              );
              if (currentSender?.connectionId === signal.epoch)
                await signalReceiver.current(event.senderId, signal);
              seen.current.add(event.seq);
            }
          } else acceptEvent(event);
        }
        cursor = snapshot.cursor;
        setMessages((old) =>
          old.filter((m) => m.createdAt > snapshot.serverNow - TEXT_VISIBLE_MS),
        );
      } catch (error) {
        if (!alive) return;
        if (error instanceof ApiError && [401, 404].includes(error.status)) {
          expires.current();
          return;
        }
        setConnection('reconnecting');
      }
      if (alive) timer = setTimeout(poll, POSITION_POLL_MS);
    }
    void poll();
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [session, signalReceiver, acceptEvent]);
  const sendText = useCallback(
    async (text: string, kind: 'chat' | 'caption' = 'chat') => {
      const result = await sendRoomAction(session, { type: kind, text });
      if (result.event) acceptEvent(result.event);
    },
    [session, acceptEvent],
  );
  const light = useCallback(async () => {
    const result = await sendRoomAction(session, { type: 'light' });
    setParticipants((old) =>
      old.map((p) =>
        p.id === session.participantId
          ? { ...p, litAt: result.litAt ?? p.litAt }
          : p,
      ),
    );
  }, [session]);
  return {
    participants,
    messages,
    connection,
    clockOffset,
    iceServers,
    sendText,
    light,
  };
}
