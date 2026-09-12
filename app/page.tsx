'use client';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { EntryScreen } from '@/domains/room/components/EntryScreen';
import { FriendRoom } from '@/domains/room/components/FriendRoom';
import { sessionKey } from '@/domains/room/api';
import type { RoomSession } from '@/domains/room/types';
const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
function initialRoomState() {
  const roomId = new URLSearchParams(window.location.search).get('room');
  let session: RoomSession | null = null;
  if (roomId) {
    try {
      const saved = sessionStorage.getItem(sessionKey(roomId));
      if (saved) {
        const value = JSON.parse(saved) as RoomSession;
        if (
          value.roomId === roomId &&
          typeof value.token === 'string' &&
          typeof value.participantId === 'string'
        )
          session = { ...value, connectionId: crypto.randomUUID() };
      }
    } catch {
      /* Optional session recovery. */
    }
  }
  return { roomId, session, notice: '' };
}
function ClientRoomApp() {
  const [{ roomId, session, notice }, setState] = useState(initialRoomState);
  const enter = useCallback((next: RoomSession) => {
    window.history.replaceState({}, '', `/?room=${next.roomId}`);
    setState({ roomId: next.roomId, session: next, notice: '' });
  }, []);
  const exit = useCallback(
    (message?: string) => {
      if (roomId) {
        try {
          sessionStorage.removeItem(sessionKey(roomId));
        } catch {
          /* Optional storage. */
        }
      }
      if (!message) window.history.replaceState({}, '', '/');
      setState({
        session: null,
        notice: message ?? '',
        roomId: message ? roomId : null,
      });
    },
    [roomId],
  );
  const home = useCallback(() => {
    window.history.replaceState({}, '', '/');
    setState({ roomId: null, session: null, notice: '' });
  }, []);
  if (session)
    return (
      <FriendRoom key={session.participantId} session={session} onExit={exit} />
    );
  return (
    <EntryScreen
      key={roomId ?? 'new'}
      roomId={roomId}
      onEnter={enter}
      initialNotice={notice}
      onHome={home}
    />
  );
}
export default function Home() {
  const ready = useSyncExternalStore(
    subscribeToHydration,
    clientReady,
    serverReady,
  );
  if (!ready)
    return (
      <main className="room-shell entry-shell">
        <header className="topbar">
          <div className="brand">
            <h1>흡연장</h1>
          </div>
        </header>
        <output className="loading-room">자리를 준비하고 있어요.</output>
      </main>
    );
  return <ClientRoomApp />;
}
