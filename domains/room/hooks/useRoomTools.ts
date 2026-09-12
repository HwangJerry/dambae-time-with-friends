'use client';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { MAX_TEXT_LENGTH, type Participant } from '../types';
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
type ToolDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: Tool,
      options: { signal: AbortSignal },
    ) => void | Promise<void>;
  };
};
export function useRoomTools(
  participants: Participant[],
  draft: string,
  setDraft: (draft: string) => void,
) {
  const current = useRef({ participants, draft, setDraft });
  useEffect(() => {
    current.current = { participants, draft, setDraft };
  }, [participants, draft, setDraft]);
  useEffect(() => {
    const context = (document as ToolDocument).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    const tools: Tool[] = [
      {
        name: 'get_smoking_room_state',
        description:
          'Read the current participants and unsent chat draft in this friend room.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute() {
          return {
            participants: current.current.participants.map((p) => ({
              nickname: p.nickname,
              micOn: p.micOn,
              litAt: p.litAt,
            })),
            draft: current.current.draft,
          };
        },
      },
      {
        name: 'stage_smoking_room_chat',
        description:
          'Place text in the visible chat input for review. Does not send the message.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH },
          },
          required: ['text'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute(input) {
          const text = (input as { text?: unknown } | null)?.text;
          if (
            typeof text !== 'string' ||
            !text.trim() ||
            text.length > MAX_TEXT_LENGTH
          )
            throw new Error('Text must contain 1–160 characters.');
          flushSync(() => current.current.setDraft(text));
          return { status: 'staged', text };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: controller.signal }),
        ).catch(() => undefined);
      } catch {
        /* Optional API cannot break the room. */
      }
    }
    return () => controller.abort();
  }, []);
}
