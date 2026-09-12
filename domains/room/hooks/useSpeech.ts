'use client';
import { useEffect, useRef, useState } from 'react';
import { MAX_TEXT_LENGTH } from '../types';
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: { resultIndex: number; results: SpeechResult[] }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function useSpeech(
  micOn: boolean,
  onFinal: (text: string) => Promise<void>,
) {
  const [status, setStatus] = useState<
    'off' | 'listening' | 'unsupported' | 'error'
  >('off');
  const [interim, setInterim] = useState('');
  const [retry, setRetry] = useState(0);
  const callback = useRef(onFinal);
  useEffect(() => {
    callback.current = onFinal;
  }, [onFinal]);
  useEffect(() => {
    const Constructor =
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!Constructor || !micOn) return;
    let alive = true,
      failed = false,
      restart: ReturnType<typeof setTimeout> | undefined;
    let queue = Promise.resolve();
    const recognition = new Constructor();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      if (alive) {
        setStatus('listening');
        setInterim('');
      }
    };
    recognition.onresult = (event) => {
      let draft = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i],
          text = result[0].transcript.trim();
        if (result.isFinal && text) {
          for (
            let offset = 0;
            offset < text.length;
            offset += MAX_TEXT_LENGTH
          ) {
            const part = text.slice(offset, offset + MAX_TEXT_LENGTH);
            queue = queue
              .then(async () => {
                if (!alive) return;
                await callback.current(part);
                await new Promise((resolve) => setTimeout(resolve, 450));
              })
              .catch(() => {
                if (alive) setStatus('error');
              });
          }
        } else draft += text;
      }
      setInterim(draft.slice(-MAX_TEXT_LENGTH));
    };
    recognition.onerror = (event) => {
      if (!alive || event.error === 'aborted') return;
      if (event.error === 'no-speech') return;
      failed = true;
      setStatus('error');
      setInterim('');
    };
    const start = () => {
      if (!alive || failed) return;
      try {
        recognition.start();
      } catch {
        failed = true;
        setStatus('error');
      }
    };
    recognition.onend = () => {
      if (alive && !failed) restart = setTimeout(start, 600);
    };
    start();
    return () => {
      alive = false;
      clearTimeout(restart);
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.abort();
    };
  }, [micOn, retry]);
  const supported =
    typeof window !== 'undefined' &&
    Boolean(
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition,
    );
  const visibleStatus = (() => {
    if (!supported) return 'unsupported' as const;
    if (!micOn) return 'off' as const;
    return status;
  })();
  return {
    status: visibleStatus,
    interim: micOn ? interim : '',
    retry: () => setRetry((old) => old + 1),
  };
}
