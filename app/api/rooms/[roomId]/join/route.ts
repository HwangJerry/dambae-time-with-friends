import { joinRoom } from '@/domains/room/server/rooms';
import { handleRoute, json, readBody } from '@/domains/room/server/http';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  return handleRoute(async () => {
    const body = await readBody(request);
    return json(
      await joinRoom((await params).roomId, body.nickname, body.avatar),
      201,
    );
  });
}
