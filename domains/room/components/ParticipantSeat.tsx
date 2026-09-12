'use client';
import { Mic, MicOff, Volume2, VolumeX, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Cigarette, getBurnGeometry } from './Cigarette';
import { Smoke } from './Smoke';
import {
  CIGARETTE_DURATION_MS,
  TEXT_VISIBLE_MS,
  type Participant,
  type SmokeMessage,
} from '../types';
import type { CSSProperties } from 'react';
export function ParticipantSeat({
  participant,
  isSelf,
  micOn,
  now,
  messages,
  interim,
  muted,
  onMute,
  status,
}: {
  participant: Participant;
  isSelf: boolean;
  micOn: boolean;
  now: number;
  messages: SmokeMessage[];
  interim?: string;
  muted: boolean;
  onMute: () => void;
  status?: RTCPeerConnectionState;
}) {
  const progress =
    participant.litAt === null
      ? 0
      : Math.min(
          1,
          Math.max(0, (now - participant.litAt) / CIGARETTE_DURATION_MS),
        );
  const lit = participant.litAt !== null && progress < 1;
  const visible = messages
    .filter(
      (m) =>
        m.senderId === participant.id && now - m.createdAt < TEXT_VISIBLE_MS,
    )
    .slice(-3);
  const style = {
    '--burn': getBurnGeometry(progress).ashTop,
    '--seat-tilt': `${[-4, 3, -2, 5][participant.seat]}deg`,
  } as CSSProperties;
  return (
    <section
      className={`participant-seat ${isSelf ? 'self-seat' : ''}`}
      style={style}
      aria-label={`${participant.nickname}${isSelf ? ' (나)' : ''}`}
    >
      <div className="seat-atmosphere">
        <Smoke
          active={lit || visible.length > 0 || Boolean(interim)}
          origin={98}
        />
      </div>
      <div className="smoke-messages" aria-live="polite" aria-atomic="false">
        {visible.map((message, index) => {
          const age = Math.max(0, now - message.createdAt),
            fraction = Math.min(1, age / TEXT_VISIBLE_MS);
          return (
            <p
              key={message.id}
              className="smoke-message"
              style={{
                transform: `translate(-50%, calc(-35px - ${fraction} * var(--text-rise) - ${(visible.length - index - 1) * 24}px))`,
                opacity: Math.min(1, (1 - fraction) * 1.6),
                filter: `blur(${Math.max(0, fraction - 0.65) * 4}px)`,
              }}
            >
              {message.kind === 'chat' && (
                <Keyboard size={11} aria-label="채팅" />
              )}
              {message.text}
            </p>
          );
        })}
        {interim && <p className="interim-message">{interim}</p>}
      </div>
      <div className="seat-cigarette">
        <Cigarette progress={progress} lit={lit} />
      </div>
      <div className="seat-name">
        <span className={micOn ? 'mic-indicator active' : 'mic-indicator'}>
          {micOn ? <Mic size={13} /> : <MicOff size={13} />}
        </span>
        <span>{participant.nickname}</span>
        {isSelf && <span className="you-label">나</span>}
        {!isSelf && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMute}
            aria-label={`${participant.nickname} ${muted ? '소리 켜기' : '음소거'}`}
            aria-pressed={muted}
            className="peer-mute"
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </Button>
        )}
      </div>
      <span className="seat-state">
        {lit ? '함께 피우는 중' : '잠깐 머무는 중'}
        {!isSelf && status === 'failed' ? ' · 음성 연결 안 됨' : ''}
      </span>
    </section>
  );
}
