import { syncRoom } from '@/domains/room/server/rooms';
import { handleRoute, json } from '@/domains/room/server/http';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  return handleRoute(async () =>
    json(await syncRoom(request, (await params).roomId)),
  );
}
