import { NextRequest, NextResponse } from "next/server";
import { kv } from "@/lib/kv";

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    const { path = "/" } = (await request.json().catch(() => ({}))) as {
      path?: string;
    };

    const today = new Date().toISOString().slice(0, 10); // "2026-05-29"

    // PV: increment daily counter
    await kv.incr(`pv:${today}`);
    // Page-level PV
    await kv.incr(`pv:${today}:${path}`);
    // UV: HyperLogLog
    await kv.pfadd(`uv:${today}`, ip);

    // 30-day TTL
    const ttl = 60 * 60 * 24 * 30;
    await kv.expire(`pv:${today}`, ttl);
    await kv.expire(`pv:${today}:${path}`, ttl);
    await kv.expire(`uv:${today}`, ttl);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("track error", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
