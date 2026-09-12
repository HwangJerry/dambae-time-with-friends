import { createRoom } from '@/domains/room/server/rooms';
import { handleRoute, json, readBody } from '@/domains/room/server/http';
export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await readBody(request);
    return json(await createRoom(body.nickname, body.avatar), 201);
  });
}
