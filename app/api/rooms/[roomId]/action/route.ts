import { roomAction } from '@/domains/room/server/rooms';
import { handleRoute, json, readBody } from '@/domains/room/server/http';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  return handleRoute(async () =>
    json(
      await roomAction(request, (await params).roomId, await readBody(request)),
    ),
  );
}
