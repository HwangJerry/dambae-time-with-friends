'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { distanceVolume } from '../spatial';
import { sendRoomAction } from '../api';
import type { Participant, RoomSession, Signal } from '../types';

function closePeer(peer: Peer) {
  peer.source?.disconnect();
  peer.gain.disconnect();
  peer.pc.close();
  peer.audio.pause();
  peer.audio.srcObject = null;
}
type Peer = {
  pc: RTCPeerConnection;
  epoch?: string;
  sender: RTCRtpSender;
  audio: HTMLAudioElement;
  gain: GainNode;
  source?: MediaStreamAudioSourceNode;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingAnswer: boolean;
  candidates: RTCIceCandidateInit[];
  outbound: Promise<unknown>;
};
export function useVoice(
  session: RoomSession,
  participants: Participant[],
  iceServers: RTCIceServer[],
) {
  const audioContext = useRef<AudioContext | null>(null);
  const volumes = useRef(new Map<string, number>());
  const peers = useRef(new Map<string, Peer>());
  const stream = useRef<MediaStream | null>(null);
  const ice = useRef(iceServers);
  useEffect(() => {
    ice.current = iceServers;
    if (iceServers.length)
      for (const peer of peers.current.values()) {
        peer.pc.setConfiguration({ iceServers });
      }
  }, [iceServers]);
  const alive = useRef(true);
  const micLock = useRef(false);
  const generation = useRef(0);
  const [micOn, setMicOn] = useState(false),
    [micBusy, setMicBusy] = useState(false);
  const [error, setError] = useState(''),
    [audioBlocked, setAudioBlocked] = useState(false);
  const [mutedPeers, setMutedPeers] = useState<Set<string>>(new Set());
  const mutedRef = useRef(new Set<string>());
  const [peerStatus, setPeerStatus] = useState<
    Record<string, RTCPeerConnectionState>
  >({});
  useEffect(() => {
    const listener = participants.find((p) => p.id === session.participantId);
    volumes.current = new Map(
      participants.map((p) => [
        p.id,
        listener ? distanceVolume(listener, p) : 0,
      ]),
    );
    for (const [id, peer] of peers.current) {
      const volume = mutedRef.current.has(id)
        ? 0
        : (volumes.current.get(id) ?? 0);
      const time = peer.gain.context.currentTime;
      peer.gain.gain.cancelScheduledValues(time);
      if (volume === 0) peer.gain.gain.setValueAtTime(0, time);
      else peer.gain.gain.setTargetAtTime(volume, time, 0.08);
    }
  }, [participants, session.participantId]);
  const ensurePeer = useCallback(
    (id: string, epoch?: string) => {
      const existing = peers.current.get(id);
      if (existing && (!epoch || existing.epoch === epoch)) return existing;
      if (existing) closePeer(existing);
      const pc = new RTCPeerConnection({
        iceServers: ice.current.length
          ? ice.current
          : [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      const audio = new Audio();
      audio.autoplay = true;
      audio.muted = true; // Stream playout stays silent; Web Audio owns the output.
      const context = audioContext.current ?? new AudioContext();
      audioContext.current = context;
      const gain = context.createGain();
      gain.gain.value = mutedRef.current.has(id)
        ? 0
        : (volumes.current.get(id) ?? 0);
      gain.connect(context.destination);
      const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const peer: Peer = {
        pc,
        epoch,
        sender: transceiver.sender,
        audio,
        gain,
        makingOffer: false,
        ignoreOffer: false,
        settingAnswer: false,
        candidates: [],
        outbound: Promise.resolve(),
      };
      peers.current.set(id, peer);
      const track = stream.current?.getAudioTracks()[0];
      if (track) void peer.sender.replaceTrack(track);
      function send(signal: Signal) {
        peer.outbound = peer.outbound
          .catch(() => undefined)
          .then(async () => {
            if (!alive.current || pc.signalingState === 'closed') return;
            await sendRoomAction(session, {
              type: 'signal',
              targetId: id,
              signal,
            });
          });
        return peer.outbound;
      }
      pc.onicecandidate = (event) => {
        if (event.candidate)
          void send({ candidate: event.candidate.toJSON() }).catch(() =>
            setError('음성 연결을 다시 시도해 주세요.'),
          );
      };
      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription)
            await send({ description: pc.localDescription.toJSON() });
        } catch {
          if (alive.current) setError('음성 연결을 다시 시도해 주세요.');
        } finally {
          peer.makingOffer = false;
        }
      };
      pc.ontrack = (event) => {
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        audio.srcObject = remoteStream;
        peer.source?.disconnect();
        peer.source = context.createMediaStreamSource(remoteStream);
        peer.source.connect(gain);
        if (context.state !== 'running') setAudioBlocked(true);
        void audio.play().catch(() => {
          if (alive.current) setAudioBlocked(true);
        });
      };
      pc.onconnectionstatechange = () => {
        if (!alive.current) return;
        setPeerStatus((old) => ({ ...old, [id]: pc.connectionState }));
        if (pc.connectionState === 'failed')
          setError(
            '친구의 목소리가 연결되지 않았어요. 음성을 다시 연결해 주세요.',
          );
      };
      return peer;
    },
    [session],
  );
  const receiveSignal = useCallback(
    async (id: string, signal: Signal) => {
      if (!alive.current) return;
      const peer = ensurePeer(id, signal.epoch),
        pc = peer.pc;
      try {
        if (signal.description) {
          const description = signal.description;
          const ready =
            !peer.makingOffer &&
            (pc.signalingState === 'stable' || peer.settingAnswer);
          const collision = description.type === 'offer' && !ready;
          const polite = session.participantId.localeCompare(id) > 0;
          peer.ignoreOffer = !polite && collision;
          if (peer.ignoreOffer) return;
          peer.settingAnswer = description.type === 'answer';
          await pc.setRemoteDescription(description);
          peer.settingAnswer = false;
          for (const candidate of peer.candidates.splice(0))
            await pc.addIceCandidate(candidate);
          if (description.type === 'offer') {
            await pc.setLocalDescription();
            if (pc.localDescription)
              await sendRoomAction(session, {
                type: 'signal',
                targetId: id,
                signal: { description: pc.localDescription.toJSON() },
              });
          }
        } else if (signal.candidate && !peer.ignoreOffer) {
          if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
          else peer.candidates.push(signal.candidate);
        }
      } catch {
        peer.settingAnswer = false;
        if (alive.current) setError('음성 연결을 다시 시도해 주세요.');
      }
    },
    [ensurePeer, session],
  );
  useEffect(() => {
    const active = new Set(
      participants
        .filter((p) => p.id !== session.participantId)
        .map((p) => p.id),
    );
    for (const participant of participants)
      if (active.has(participant.id))
        ensurePeer(participant.id, participant.connectionId);
    for (const [id, peer] of peers.current) {
      if (!active.has(id)) {
        closePeer(peer);
        peers.current.delete(id);
      }
    }
  }, [participants, ensurePeer, session.participantId]);
  const stopMicrophone = useCallback(() => {
    generation.current += 1;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    for (const peer of peers.current.values())
      void peer.sender.replaceTrack(null).catch(() => undefined);
    setMicOn(false);
  }, []);
  const toggleMicrophone = useCallback(async () => {
    if (micLock.current) return;
    micLock.current = true;
    setMicBusy(true);
    setError('');
    try {
      if (audioContext.current?.state === 'suspended') {
        await audioContext.current.resume();
        setAudioBlocked(false);
      }
      if (stream.current) {
        stopMicrophone();
        await sendRoomAction(session, { type: 'mic', enabled: false });
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const current = generation.current;
      const next = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!alive.current || current !== generation.current) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = next;
      await Promise.all(
        [...peers.current.values()].map((p) =>
          p.sender.replaceTrack(next.getAudioTracks()[0]),
        ),
      );
      await sendRoomAction(session, { type: 'mic', enabled: true });
      setMicOn(true);
      for (const track of next.getAudioTracks())
        track.onended = () => {
          stopMicrophone();
          void sendRoomAction(session, { type: 'mic', enabled: false }).catch(
            () => undefined,
          );
        };
    } catch (e) {
      stopMicrophone();
      const denied =
        e instanceof DOMException &&
        ['NotAllowedError', 'PermissionDeniedError'].includes(e.name);
      setError(
        denied
          ? '마이크 권한이 꺼져 있어요. 브라우저에서 허용하거나 채팅으로 함께해 주세요.'
          : '마이크를 연결하지 못했어요. 장치와 연결을 확인해 주세요.',
      );
    } finally {
      micLock.current = false;
      if (alive.current) setMicBusy(false);
    }
  }, [session, stopMicrophone]);
  const enableAudio = useCallback(async () => {
    try {
      await audioContext.current?.resume();
    } catch {
      setAudioBlocked(true);
      return;
    }
    const results = await Promise.allSettled(
      [...peers.current.values()].map((p) => p.audio.play()),
    );
    setAudioBlocked(
      audioContext.current?.state === 'suspended' ||
        results.some((r) => r.status === 'rejected'),
    );
  }, []);
  const togglePeerMute = useCallback((id: string) => {
    const next = new Set(mutedRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    mutedRef.current = next;
    setMutedPeers(next);
    const peer = peers.current.get(id);
    if (peer) {
      const time = peer.gain.context.currentTime;
      peer.gain.gain.cancelScheduledValues(time);
      peer.gain.gain.setValueAtTime(
        next.has(id) ? 0 : (volumes.current.get(id) ?? 0),
        time,
      );
    }
  }, []);
  const reconnectVoice = useCallback(() => {
    setError('');
    for (const peer of peers.current.values()) peer.pc.restartIce();
    void enableAudio();
  }, [enableAudio]);
  useEffect(() => {
    alive.current = true;
    const connections = peers.current;
    return () => {
      alive.current = false;
      generation.current += 1;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      for (const peer of connections.values()) closePeer(peer);
      connections.clear();
      void audioContext.current?.close();
      audioContext.current = null;
    };
  }, []);
  return {
    micOn,
    micBusy,
    error,
    audioBlocked,
    peerStatus,
    mutedPeers,
    receiveSignal,
    toggleMicrophone,
    stopMicrophone,
    togglePeerMute,
    enableAudio,
    reconnectVoice,
  };
}
