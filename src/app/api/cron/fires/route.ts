import { NextRequest, NextResponse } from "next/server";
import { runFireCheck } from "@/lib/server/fireSchedule";
import { isAdmin, safeEqual } from "@/lib/server/security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Checks NASA FIRMS for new forest-region fires and sends alerts, for
// schedulers outside the server (Vercel Cron, cron-job.org, GitHub Actions).
// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; an admin can also
// call it with the x-admin-key header.
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth && safeEqual(auth, `Bearer ${secret}`)) return true;
  return isAdmin(req);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const result = await runFireCheck();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
