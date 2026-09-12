'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sendRoomAction } from '../api';
import { POSITION_SEND_MS, isWalkable, type Position } from '../spatial';
import type { Participant, RoomSession } from '../types';

export function useSpatialMovement(
  session: RoomSession,
  self: Participant | undefined,
  connected: boolean,
) {
  const [position, setPosition] = useState<Position | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<Position | null>(null);
  const accepted = useRef<Position | null>(null);
  useEffect(() => {
    if (!self || accepted.current) return;
    const initial = { x: self.x, z: self.z };
    accepted.current = initial;
    setPosition(initial);
  }, [self]);
  useEffect(() => {
    let alive = true;
    let busy = false;
    const timer = setInterval(async () => {
      if (!connected || busy || !pending.current) return;
      const next = pending.current;
      pending.current = null;
      busy = true;
      try {
        await sendRoomAction(session, { type: 'move', ...next });
        if (alive) {
          accepted.current = next;
          setError('');
        }
      } catch {
        if (alive) {
          pending.current = null;
          setPosition(accepted.current);
          setError('이동 위치를 전하지 못했어요. 연결 후 다시 움직여 주세요.');
        }
      } finally {
        busy = false;
      }
    }, POSITION_SEND_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session, connected]);
  const move = useCallback(
    (next: Position) => {
      if (!connected || !isWalkable(next)) return;
      pending.current = next;
      setPosition(next);
    },
    [connected],
  );
  return { position, move, error };
}
