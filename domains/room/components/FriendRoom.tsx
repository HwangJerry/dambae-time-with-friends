'use client';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Check,
  Copy,
  Flame,
  LogOut,
  Mic,
  MicOff,
  Send,
  LoaderCircle,
  Volume2,
  VolumeX,
  RotateCcw,
  Wind,
  Captions,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSpatialMovement } from '../hooks/useSpatialMovement';
import { distanceVolume } from '../spatial';
const SmokingYard = lazy(() =>
  import('./SmokingYard').then((module) => ({ default: module.SmokingYard })),
);
import { useRoom } from '../hooks/useRoom';
import { useVoice } from '../hooks/useVoice';
import { useBurnSound } from '../hooks/useBurnSound';
import { useSpeech } from '../hooks/useSpeech';
import { useRoomTools } from '../hooks/useRoomTools';
import {
  CIGARETTE_DURATION_MS,
  MAX_TEXT_LENGTH,
  ROOM_CAPACITY,
  type RoomSession,
  type Signal,
} from '../types';
import { sendRoomAction, sessionKey } from '../api';
export function FriendRoom({
  session,
  onExit,
}: {
  session: RoomSession;
  onExit: (notice?: string) => void;
}) {
  const signalReceiver = useRef<
    ((sender: string, signal: Signal) => Promise<void>) | null
  >(null);
  const [draft, setDraft] = useState(''),
    [sending, setSending] = useState(false),
    [lighting, setLighting] = useState(false),
    [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState(''),
    [copied, setCopied] = useState(false),
    [copyFallback, setCopyFallback] = useState('');
  const [clock, setClock] = useState(() => Date.now()),
    [captionsEnabled, setCaptionsEnabled] = useState(true),
    [showCaptionNote, setShowCaptionNote] = useState(false);
  const settingsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismissSettings(event: PointerEvent | KeyboardEvent) {
      const menu = settingsRef.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        menu.open = false;
        menu.querySelector('summary')?.focus();
      } else if (event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    }
    document.addEventListener('pointerdown', dismissSettings);
    document.addEventListener('keydown', dismissSettings);
    return () => {
      document.removeEventListener('pointerdown', dismissSettings);
      document.removeEventListener('keydown', dismissSettings);
    };
  }, []);
  const expired = useCallback(
    () => onExit('연결이 종료됐어요. 닉네임으로 다시 들어와 주세요.'),
    [onExit],
  );
  const room = useRoom(session, signalReceiver, expired);
  useRoomTools(room.participants, draft, setDraft);
  const self = room.participants.find((p) => p.id === session.participantId);
  const movement = useSpatialMovement(
    session,
    self,
    room.connection === 'connected',
  );
  const spatialParticipants = room.participants.map((p) =>
    p.id === session.participantId && movement.position
      ? { ...p, ...movement.position }
      : p,
  );
  const voice = useVoice(session, spatialParticipants, room.iceServers);
  useEffect(() => {
    signalReceiver.current = voice.receiveSignal;
    return () => {
      signalReceiver.current = null;
    };
  }, [voice.receiveSignal]);
  const { sendText } = room;
  const finalCaption = useCallback(
    (text: string) => sendText(text, 'caption'),
    [sendText],
  );
  const speech = useSpeech(voice.micOn && captionsEnabled, finalCaption);
  const now = clock + room.clockOffset;
  const lit =
    self?.litAt !== null &&
    self?.litAt !== undefined &&
    now - self.litAt < CIGARETTE_DURATION_MS;
  const burnSound = useBurnSound(lit);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const { stopMicrophone } = voice;
  useEffect(() => {
    const onHide = () => {
      stopMicrophone();
      void fetch(`/api/rooms/${session.roomId}/action`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          type: 'mic',
          enabled: false,
          connectionId: session.connectionId,
        }),
      }).catch(() => undefined);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [session, stopMicrophone]);
  async function copyInvite() {
    const url = new URL(window.location.origin);
    url.searchParams.set('room', session.roomId);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setCopyFallback('');
    } catch {
      setCopyFallback(url.toString());
    }
  }
  async function send(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    setNotice('');
    try {
      await room.sendText(draft.trim());
      setDraft('');
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : '보내지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      setSending(false);
    }
  }
  async function light() {
    setLighting(true);
    setNotice('');
    try {
      await room.light();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '다시 불을 붙여 주세요.');
    } finally {
      setLighting(false);
    }
  }
  async function leave() {
    if (leaving) return;
    setLeaving(true);
    voice.stopMicrophone();
    try {
      await sendRoomAction(session, { type: 'leave' });
    } catch {
      /* Presence expires even if the network is unavailable. */
    }
    try {
      sessionStorage.removeItem(sessionKey(session.roomId));
    } catch {
      /* Optional storage. */
    }
    onExit();
  }
  const connectionLabel = (() => {
    if (room.connection === 'connecting') return '자리를 준비하는 중';
    if (room.connection === 'reconnecting') return '다시 연결하는 중';
    return `${room.participants.length} / ${ROOM_CAPACITY}명`;
  })();
  const lightLabel = (() => {
    if (lit) return '천천히 타는 중';
    if (self?.litAt) return '한 대 더';
    return '불붙이기';
  })();
  const activeError =
    notice || voice.error || burnSound.error || movement.error;
  return (
    <main className="room-shell in-room">
      <header className="topbar">
        <div className="brand">
          <h1>
            <button
              type="button"
              className="room-home-button"
              onClick={leave}
              disabled={leaving}
              aria-label="흡연장 나가고 홈으로"
              title="흡연장 나가고 홈으로"
            >
              흡연장
            </button>
          </h1>
          <span className="brand-rule" />
          <output className="presence">
            <i
              className={`status-dot ${room.connection === 'connected' ? 'online' : ''}`}
            />
            {connectionLabel}
          </output>
        </div>
        <div className="room-header-actions">
          <Button className="quiet-button invite-button" onClick={copyInvite}>
            {copied ? <Check /> : <Copy />}
            <span>{copied ? '복사했어요' : '초대 링크'}</span>
          </Button>
          <details className="room-settings" ref={settingsRef}>
            <summary aria-label="흡연장 설정">
              <Settings size={19} />
            </summary>
            <div className="settings-panel">
              <h2>흡연장 설정</h2>
              <div className="room-footnote">
                <Button
                  variant="ghost"
                  className="caption-toggle"
                  onClick={burnSound.toggle}
                  aria-pressed={burnSound.enabled}
                  title="내 담배가 타는 동안 들리는 작은 소리"
                >
                  {burnSound.enabled ? (
                    <Volume2 size={14} />
                  ) : (
                    <VolumeX size={14} />
                  )}
                  {burnSound.enabled ? '타는 소리 켜짐' : '타는 소리 꺼짐'}
                </Button>
                <Button
                  variant="ghost"
                  className="caption-toggle"
                  onClick={() => setCaptionsEnabled((v) => !v)}
                  disabled={speech.status === 'unsupported'}
                  aria-pressed={
                    captionsEnabled && speech.status !== 'unsupported'
                  }
                >
                  <Captions size={14} />
                  {speech.status === 'unsupported'
                    ? '이 브라우저는 음성 자막을 지원하지 않아요'
                    : captionsEnabled
                      ? '음성 자막 켜짐'
                      : '음성 자막 꺼짐'}
                </Button>
                <Button
                  variant="ghost"
                  className="caption-info"
                  onClick={() => setShowCaptionNote((v) => !v)}
                  aria-expanded={showCaptionNote}
                >
                  대화 안내
                </Button>
              </div>
              {showCaptionNote && (
                <p className="privacy-note">
                  음성 자막은 브라우저의 음성 인식을 사용하며, 브라우저
                  제공자에게 음성이 전송될 수 있어요. 자막을 끄면 인식도 멈춰요.
                  앱은 음성을 녹음하지 않으며, 글자와 연결 정보는 전달을 위해
                  최대 2분간 임시 보관 후 다음 요청에서 정리해요.
                </p>
              )}{' '}
              <div className="nearby-people" aria-label="친구와의 거리">
                <span className="distance-note">
                  1.8m 안 또렷하게 · 7m 밖 무음
                </span>
                {spatialParticipants
                  .filter((p) => p.id !== session.participantId)
                  .map((p) => {
                    const listener = movement.position ?? self;
                    const distance = listener
                      ? Math.hypot(listener.x - p.x, listener.z - p.z)
                      : 0;
                    const audible = listener && distanceVolume(listener, p) > 0;
                    const muted = voice.mutedPeers.has(p.id);
                    return (
                      <Button
                        variant="ghost"
                        key={p.id}
                        onClick={() => voice.togglePeerMute(p.id)}
                        aria-pressed={muted}
                        aria-label={`${p.nickname} ${muted ? '소리 켜기' : '음소거'}`}
                      >
                        {muted || !audible ? (
                          <VolumeX size={13} />
                        ) : (
                          <Volume2 size={13} />
                        )}
                        {p.nickname}{' '}
                        <span>
                          {distance.toFixed(1)}m{!audible ? ' · 멀리 있음' : ''}
                        </span>
                      </Button>
                    );
                  })}
              </div>
              <p className="controls-note">
                방향키로 이동 · 화면을 드래그해 둘러보기 · 휠로 확대
                <br />
                친구 가까이 가면 목소리가 더 잘 들려요.
              </p>
              <Button
                className="quiet-button leave-button"
                onClick={leave}
                disabled={leaving}
                aria-label="흡연장 나가기"
              >
                {leaving ? <LoaderCircle className="spinning" /> : <LogOut />}
                <span>나가기</span>
              </Button>
            </div>
          </details>
        </div>
      </header>
      {copyFallback && (
        <div className="copy-fallback">
          <label htmlFor="invite-url">
            링크를 복사해서 친구에게 보내 주세요
          </label>
          <Input
            id="invite-url"
            readOnly
            value={copyFallback}
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}
      <div className="yard-wrap">
        <Suspense
          fallback={
            <div className="yard-loading">흡연장을 준비하고 있어요…</div>
          }
        >
          <SmokingYard
            participants={spatialParticipants.map((p) =>
              p.id === session.participantId ? { ...p, micOn: voice.micOn } : p,
            )}
            selfId={session.participantId}
            messages={room.messages}
            now={now}
            canMove={room.connection === 'connected' && !leaving}
            onMove={movement.move}
          />
        </Suspense>
      </div>
      <div className="room-bottom">
        {activeError && (
          <div className="room-notice" role="alert">
            {activeError}
            {voice.error && (
              <Button variant="ghost" onClick={voice.reconnectVoice}>
                <RotateCcw size={14} />
                음성 다시 연결
              </Button>
            )}
          </div>
        )}
        {voice.audioBlocked && (
          <Button
            className="quiet-button audio-unlock"
            onClick={voice.enableAudio}
          >
            <Volume2 size={16} /> 친구 목소리 듣기
          </Button>
        )}
        {speech.status === 'error' && (
          <div className="room-notice">
            말을 글자로 옮기지 못하고 있어요. 목소리와 채팅은 계속 사용할 수
            있어요.
            <Button variant="ghost" onClick={speech.retry}>
              자막 재시도
            </Button>
          </div>
        )}
        <div className="room-toolbar">
          <Button
            className={`quiet-button mic-button ${voice.micOn ? 'is-on' : ''}`}
            onClick={voice.toggleMicrophone}
            disabled={voice.micBusy || room.connection !== 'connected'}
            aria-pressed={voice.micOn}
            aria-label={voice.micOn ? '마이크 끄기' : '마이크 켜기'}
          >
            {voice.micBusy ? (
              <LoaderCircle className="spinning" />
            ) : voice.micOn ? (
              <Mic />
            ) : (
              <MicOff />
            )}
            <span>{voice.micOn ? '마이크 켜짐' : '마이크 꺼짐'}</span>
          </Button>
          <form className="chat-form" onSubmit={send}>
            <Input
              className="chat-input"
              aria-label="연기에 띄울 말"
              placeholder="연기에 띄울 말…"
              maxLength={MAX_TEXT_LENGTH}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={leaving}
            />
            <Button
              variant="ghost"
              size="icon"
              type="submit"
              aria-label="채팅 보내기"
              disabled={
                sending || !draft.trim() || room.connection !== 'connected'
              }
            >
              {sending ? <LoaderCircle className="spinning" /> : <Send />}
            </Button>
          </form>
          <Button
            className={`quiet-button light-button ${lit ? 'is-burning' : ''}`}
            onClick={light}
            disabled={
              lit || lighting || !self || room.connection !== 'connected'
            }
          >
            {lighting ? (
              <LoaderCircle className="spinning" />
            ) : lit ? (
              <Wind />
            ) : (
              <Flame />
            )}
            <span>{lightLabel}</span>
            {lit && self?.litAt && (
              <span
                className="burn-progress"
                aria-hidden="true"
                style={{
                  width: `${Math.max(0, 1 - (now - self.litAt) / CIGARETTE_DURATION_MS) * 100}%`,
                }}
              />
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}
