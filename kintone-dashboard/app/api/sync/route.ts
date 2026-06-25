import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runSync } from "@/lib/kintoneSync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // @libsql/client は Node ランタイムが必要
export const maxDuration = 60; // Hobby の上限内

/**
 * kintone → Turso 差分同期。
 * Vercel Cron から毎日1回叩かれる。CRON_SECRET で外部実行を遮断。
 * 手動実行: curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/sync
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runSync(db);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "sync failed" },
      { status: 500 }
    );
  }
}
