'use client';
import { useEffect, useRef, useState } from 'react';

const LOOP_SECONDS = 16;
const SOUND_VOLUME = 0.12;
const FADE_SECONDS = 0.2;
const CRACKLES_PER_SECOND = 5;
const CRACKLE_SECONDS = 0.012;

/** Local ambience only: this audio is never connected to microphone/WebRTC. */
export function useBurnSound(burning: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
  const enabling = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void audio.current?.context.close();
      audio.current = null;
    };
  }, []);
  useEffect(() => {
    if (!audio.current) return;
    const { context, gain } = audio.current;
    gain.gain.setTargetAtTime(
      enabled && burning ? SOUND_VOLUME : 0,
      context.currentTime,
      FADE_SECONDS,
    );
  }, [burning, enabled]);

  async function toggle() {
    if (enabling.current) return;
    setError('');
    if (enabled) {
      setEnabled(false);
      const previous = audio.current;
      audio.current = null;
      await previous?.context.close();
      return;
    }
    enabling.current = true;
    try {
      const context = new AudioContext();
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(context.destination);
      audio.current = { context, gain };
      // Resume during the button gesture for browser autoplay policies.
      await context.resume();
      if (!mounted.current) {
        await context.close();
        return;
      }
      const buffer = context.createBuffer(
        1,
        context.sampleRate * LOOP_SECONDS,
        context.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      let rustle = 0;
      for (let i = 0; i < samples.length; i++) {
        rustle = rustle * 0.96 + (Math.random() * 2 - 1) * 0.04;
        samples[i] = rustle * 0.2;
      }
      const crackleLength = Math.floor(context.sampleRate * CRACKLE_SECONDS);
      for (let n = 0; n < LOOP_SECONDS * CRACKLES_PER_SECOND; n++) {
        const start = Math.floor(
          Math.random() * (samples.length - crackleLength),
        );
        const intensity = 0.15 + Math.random() * 0.65;
        for (let j = 0; j < crackleLength; j++) {
          samples[start + j] +=
            (Math.random() * 2 - 1) *
            intensity *
            Math.exp(-j / (crackleLength / 6));
        }
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 4200;
      source.connect(filter).connect(gain);
      source.start();
      setEnabled(true);
    } catch {
      void audio.current?.context.close();
      audio.current = null;
      if (mounted.current) {
        setEnabled(false);
        setError('타는 소리를 켜지 못했어요. 다시 눌러 주세요.');
      }
    } finally {
      enabling.current = false;
    }
  }
  return { enabled, toggle, error };
}
