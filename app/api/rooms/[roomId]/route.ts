import { roomInfo } from '@/domains/room/server/rooms';
import { handleRoute, json } from '@/domains/room/server/http';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  return handleRoute(async () => json(await roomInfo((await params).roomId)));
}
