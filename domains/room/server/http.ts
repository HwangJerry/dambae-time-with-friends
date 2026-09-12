export class RoomError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function handleRoute(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof RoomError)
      return json({ error: error.message }, error.status);
    console.error(
      'Room operation failed',
      error instanceof Error ? error.message : 'unknown',
    );
    return json({ error: '잠깐 연결이 어려워요. 다시 시도해 주세요.' }, 500);
  }
}
export async function readBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const MAX_BODY_BYTES = 32_768;
  const reader = request.body?.getReader();
  if (!reader) throw new RoomError(400, '요청 내용을 확인해 주세요.');
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RoomError(413, '내용이 너무 길어요.');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new RoomError(400, '요청 내용을 확인해 주세요.');
  }
}
export function validateName(value: unknown) {
  if (typeof value !== 'string')
    throw new RoomError(400, '닉네임을 입력해 주세요.');
  const name = value.trim();
  const hasControlCharacter = Array.from(name).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
  if (!name || name.length > 16 || hasControlCharacter)
    throw new RoomError(400, '닉네임은 1~16자로 입력해 주세요.');
  return name;
}
export function validateId(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      value,
    )
  )
    throw new RoomError(404, '초대 링크를 확인해 주세요.');
}

export function validateAvatar(value: unknown): 'male' | 'female' {
  if (value === undefined) return 'male';
  if (value === 'male' || value === 'female') return value;
  throw new RoomError(400, '캐릭터를 선택해 주세요.');
}
