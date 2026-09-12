'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowLeft, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AvatarPicker } from './AvatarPicker';
import { CigarettePreview } from './CigarettePreview';
import { ApiError, requestJson, sessionKey } from '../api';
import type { RoomSession, AvatarStyle } from '../types';
export function EntryScreen({
  roomId,
  onEnter,
  initialNotice,
  onHome,
}: {
  roomId: string | null;
  onEnter: (session: RoomSession) => void;
  initialNotice?: string;
  onHome: () => void;
}) {
  const [name, setName] = useState(() => {
      try {
        return localStorage.getItem('smoking-room-nickname') ?? '';
      } catch {
        return '';
      }
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialNotice ?? '');
  const [roomState, setRoomState] = useState<'checking' | 'ready' | 'closed'>(
    roomId ? 'checking' : 'ready',
  );
  const [count, setCount] = useState(0);
  const [avatar, setAvatar] = useState<AvatarStyle>(() => {
    try {
      return localStorage.getItem('smoking-room-avatar') === 'female'
        ? 'female'
        : 'male';
    } catch {
      return 'male';
    }
  });
  useEffect(() => {
    if (!roomId) return;
    let active = true;
    requestJson<{ count: number }>(`/api/rooms/${roomId}`)
      .then((info) => {
        if (active) {
          setCount(info.count);
          setRoomState('ready');
        }
      })
      .catch((e) => {
        if (active) {
          setRoomState(
            e instanceof ApiError && e.status === 404 ? 'closed' : 'ready',
          );
          setError(e instanceof Error ? e.message : '방을 확인하지 못했어요.');
        }
      });
    return () => {
      active = false;
    };
  }, [roomId]);
  async function enter(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!name.trim()) {
      setError('친구들이 부를 닉네임을 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const session = await requestJson<RoomSession>(
        roomId ? `/api/rooms/${roomId}/join` : '/api/rooms',
        {
          method: 'POST',
          body: JSON.stringify({ nickname: name.trim(), avatar }),
        },
      );
      try {
        localStorage.setItem('smoking-room-nickname', name.trim());
        localStorage.setItem('smoking-room-avatar', avatar);
        sessionStorage.setItem(
          sessionKey(session.roomId),
          JSON.stringify(session),
        );
      } catch {
        /* Room can work without session recovery. */
      }
      onEnter(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="room-shell entry-shell">
      <header className="topbar">
        <div className="brand">
          <h1>흡연장</h1>
        </div>
      </header>
      <section className="entry">
        <CigarettePreview />
        <div className="entry-copy">
          <div className="eyebrow">DAMBAE TIME</div>
          <h2>
            {roomId ? (
              <>
                친구가 기다리는
                <br />그 자리로.
              </>
            ) : (
              <>
                불 하나 붙이고,
                <br />
                이야기나 하자.
              </>
            )}
          </h2>
          {roomId && <p>{count}명이 있는 작은 흡연장. 편하게 들어와요.</p>}
          {roomState === 'closed' ? (
            <Button className="entry-submit" onClick={onHome}>
              <ArrowLeft size={16} /> 새 친구방 만들기
            </Button>
          ) : (
            <form onSubmit={enter}>
              <AvatarPicker value={avatar} onChange={setAvatar} />
              <label htmlFor="nickname">어떻게 부르면 될까요?</label>
              <Input
                autoComplete="nickname"
                id="nickname"
                className="entry-input"
                placeholder="닉네임"
                maxLength={16}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={error ? 'entry-error' : undefined}
              />
              <Button
                className="entry-submit"
                type="submit"
                disabled={busy || roomState === 'checking'}
              >
                {busy || roomState === 'checking' ? (
                  <LoaderCircle className="spinning" size={17} />
                ) : (
                  <ArrowUpRight size={17} />
                )}{' '}
                {roomId ? '친구방 들어가기' : '친구방 만들기'}
              </Button>
            </form>
          )}
          {error && (
            <div role="alert" id="entry-error" className="error-note">
              {error}
            </div>
          )}
          <div className="entry-note">
            최대 10명 · 마이크는 끈 채로 입장해요
            <br />
            {roomId
              ? '초대 링크를 가진 친구가 함께할 수 있어요.'
              : '실제 담배는 필요 없어요.'}
          </div>
        </div>
      </section>
    </main>
  );
}
