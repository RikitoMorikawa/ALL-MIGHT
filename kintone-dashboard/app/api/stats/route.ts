import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// ---- 集計軸のホワイトリスト（SQLインジェクション防止のため固定マッピング） ----

// 日付カラム（受注日=作成日時 / 納品日=納品_日付）
const DATE_COLUMNS = {
  created: '"作成日時"', // ISO UTC 例: 2026-06-25T08:38:00Z
  delivery: '"納品_日付"', // 例: 2026-07-03
} as const;
type DateKey = keyof typeof DATE_COLUMNS;

// 分類カラム（ステータスはkintoneで空のため、実データのある軸を採用）
const DIM_COLUMNS = {
  arrange: '"手配種別"', // 通常配送 / 手配不要 / チャーター便
  equip: '"レンタル機材"', // レンタル機器①
  corp: '"文字列__1行__1"', // 貸出先法人
} as const;
type DimKey = keyof typeof DIM_COLUMNS;

const REVENUE = '"計算"'; // 機器代+配送費-調整額 合計(税抜)

// 日付の整形式（granularityに応じて）。作成日時はJST(+9h)に補正。
function dateExpr(dateKey: DateKey, granularity: "day" | "month"): string {
  const col = DATE_COLUMNS[dateKey];
  if (dateKey === "created") {
    const jst = `datetime(${col}, '+9 hours')`;
    return granularity === "month"
      ? `strftime('%Y-%m', ${jst})`
      : `date(${jst})`;
  }
  // delivery は 'YYYY-MM-DD' のテキスト
  return granularity === "month" ? `substr(${col}, 1, 7)` : col;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const dateKey = (sp.get("dateField") as DateKey) || "created";
  const granularity = (sp.get("granularity") as "day" | "month") || "day";
  const dimKey = (sp.get("dimension") as DimKey) || "arrange";

  if (!(dateKey in DATE_COLUMNS) || !(dimKey in DIM_COLUMNS) || !["day", "month"].includes(granularity)) {
    return NextResponse.json({ error: "invalid parameter" }, { status: 400 });
  }

  const dateCol = DATE_COLUMNS[dateKey];
  const dimCol = DIM_COLUMNS[dimKey];
  const dExpr = dateExpr(dateKey, granularity);
  const notNull = `${dateCol} IS NOT NULL AND ${dateCol} != ''`;
  const dimLabel = `COALESCE(NULLIF(${dimCol}, ''), '(未設定)')`;

  try {
    // 1) 時系列（日 or 月）
    const tsRes = await db.execute(
      `SELECT ${dExpr} AS d, SUM(${REVENUE}) AS rev, COUNT(*) AS cnt
       FROM records
       WHERE ${notNull}
       GROUP BY d ORDER BY d`
    );
    const timeseries = tsRes.rows.map((r) => ({
      date: String(r.d),
      revenue: Number(r.rev ?? 0),
      count: Number(r.cnt ?? 0),
    }));

    // 2) 分類別 内訳（全件）
    const bdRes = await db.execute(
      `SELECT ${dimLabel} AS k, SUM(${REVENUE}) AS rev, COUNT(*) AS cnt
       FROM records
       GROUP BY k ORDER BY rev DESC`
    );
    const breakdown = bdRes.rows.map((r) => ({
      key: String(r.k),
      revenue: Number(r.rev ?? 0),
      count: Number(r.cnt ?? 0),
    }));

    // 3) 合計（選択した日付軸で有効な行を対象）
    const totRes = await db.execute(
      `SELECT SUM(${REVENUE}) AS rev, COUNT(*) AS cnt,
              COUNT(DISTINCT "文字列__1行__1") AS corps
       FROM records WHERE ${notNull}`
    );
    const t = totRes.rows[0];
    const revenue = Number(t?.rev ?? 0);
    const count = Number(t?.cnt ?? 0);
    const totals = {
      revenue,
      count,
      corps: Number(t?.corps ?? 0),
      avg: count > 0 ? Math.round(revenue / count) : 0,
    };

    // 4) 時系列 × 分類（積み上げ用）
    const stRes = await db.execute(
      `SELECT ${dExpr} AS d, ${dimLabel} AS k, SUM(${REVENUE}) AS rev
       FROM records
       WHERE ${notNull}
       GROUP BY d, k ORDER BY d`
    );
    const stackedMap = new Map<string, Record<string, number>>();
    const stackKeys = new Set<string>();
    for (const r of stRes.rows) {
      const d = String(r.d);
      const k = String(r.k);
      stackKeys.add(k);
      if (!stackedMap.has(d)) stackedMap.set(d, { });
      stackedMap.get(d)![k] = Number(r.rev ?? 0);
    }
    const stacked = {
      keys: Array.from(stackKeys),
      rows: Array.from(stackedMap.entries()).map(([date, vals]) => ({ date, ...vals })),
    };

    return NextResponse.json({
      params: { dateKey, granularity, dimKey },
      totals,
      timeseries,
      breakdown,
      stacked,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "query failed" }, { status: 500 });
  }
}
