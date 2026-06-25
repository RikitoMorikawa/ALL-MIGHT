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
const PRODUCT_COL = '"レンタル機材"'; // 商品（レンタル機器①）

// 日付式（作成日時はJST(+9h)補正、納品日はテキストYYYY-MM-DD）
function dayExprOf(dateKey: DateKey): string {
  const col = DATE_COLUMNS[dateKey];
  return dateKey === "created"
    ? `date(datetime(${col}, '+9 hours'))`
    : col;
}
function monthExprOf(dateKey: DateKey): string {
  const col = DATE_COLUMNS[dateKey];
  return dateKey === "created"
    ? `strftime('%Y-%m', datetime(${col}, '+9 hours'))`
    : `substr(${col}, 1, 7)`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const dateKey = (sp.get("dateField") as DateKey) || "created";
  const granularity = (sp.get("granularity") as "day" | "month") || "day";
  const product = sp.get("product") || "";
  const year = parseInt(sp.get("year") || "", 10);
  const month = parseInt(sp.get("month") || "", 10);

  if (
    !(dateKey in DATE_COLUMNS) ||
    !["day", "month"].includes(granularity) ||
    !Number.isFinite(year)
  ) {
    return NextResponse.json({ error: "invalid parameter" }, { status: 400 });
  }
  if (granularity === "day" && (!Number.isFinite(month) || month < 1 || month > 12)) {
    return NextResponse.json({ error: "invalid month" }, { status: 400 });
  }

  const dateCol = DATE_COLUMNS[dateKey];
  const dayExpr = dayExprOf(dateKey);
  const monthExpr = monthExprOf(dateKey);
  const groupExpr = granularity === "day" ? dayExpr : monthExpr;
  const notNull = `${dateCol} IS NOT NULL AND ${dateCol} != ''`;

  // ---- 期間フィルタ（プレースホルダで安全に） ----
  const clauses: string[] = [];
  const fArgs: any[] = [];
  let periodInfo: any;

  if (granularity === "day") {
    // 選択した年月の 1日〜月末
    const ym = `${year}-${pad2(month)}`;
    clauses.push(`${monthExpr} = ?`);
    fArgs.push(ym);
    periodInfo = { type: "month", year, month, ym };
  } else {
    // 年度（4月開始〜翌3月）
    const start = `${year}-04-01`;
    const end = `${year + 1}-03-31`;
    clauses.push(`${dayExpr} >= ? AND ${dayExpr} <= ?`);
    fArgs.push(start, end);
    periodInfo = { type: "fiscalYear", year, start, end };
  }

  const useProduct = product && product !== "all";
  if (useProduct) {
    clauses.push(`${PRODUCT_COL} = ?`);
    fArgs.push(product);
  }
  const extra = clauses.length ? " AND " + clauses.join(" AND ") : "";

  try {
    // 1) 時系列（期間内・日 or 月でグループ）
    const tsRes = await db.execute({
      sql: `SELECT ${groupExpr} AS d, SUM(${REVENUE}) AS rev, COUNT(*) AS cnt
       FROM records WHERE ${notNull}${extra}
       GROUP BY d ORDER BY d`,
      args: fArgs,
    });
    const timeseries = tsRes.rows.map((r) => ({
      date: String(r.d),
      revenue: Number(r.rev ?? 0),
      count: Number(r.cnt ?? 0),
    }));

    // 2) 分類別 内訳（全分類軸をまとめて。期間内）
    const dimEntries = Object.entries(DIM_COLUMNS) as [DimKey, string][];
    const bdResults = await Promise.all(
      dimEntries.map(([, col]) =>
        db.execute({
          sql: `SELECT COALESCE(NULLIF(${col}, ''), '(未設定)') AS k,
                       SUM(${REVENUE}) AS rev, COUNT(*) AS cnt
           FROM records WHERE ${notNull}${extra}
           GROUP BY k ORDER BY rev DESC`,
          args: fArgs,
        })
      )
    );
    const breakdowns = Object.fromEntries(
      dimEntries.map(([key], i) => [
        key,
        bdResults[i].rows.map((r) => ({
          key: String(r.k),
          revenue: Number(r.rev ?? 0),
          count: Number(r.cnt ?? 0),
        })),
      ])
    ) as Record<DimKey, { key: string; revenue: number; count: number }[]>;

    // 3) 合計（期間内）
    const totRes = await db.execute({
      sql: `SELECT SUM(${REVENUE}) AS rev, COUNT(*) AS cnt,
              COUNT(DISTINCT "文字列__1行__1") AS corps
       FROM records WHERE ${notNull}${extra}`,
      args: fArgs,
    });
    const t = totRes.rows[0];
    const revenue = Number(t?.rev ?? 0);
    const count = Number(t?.cnt ?? 0);
    const totals = {
      revenue,
      count,
      corps: Number(t?.corps ?? 0),
      avg: count > 0 ? Math.round(revenue / count) : 0,
    };

    // 商品リスト（全期間から。セレクタ用）
    const prodRes = await db.execute(
      `SELECT ${PRODUCT_COL} AS p, COUNT(*) AS c FROM records
       WHERE ${PRODUCT_COL} IS NOT NULL AND ${PRODUCT_COL} != ''
       GROUP BY p ORDER BY c DESC`
    );
    const products = prodRes.rows.map((r) => String(r.p));

    // データの日付範囲（年/年度セレクタの選択肢生成用。選択日付軸ベース）
    const rangeRes = await db.execute(
      `SELECT MIN(${dayExpr}) AS mn, MAX(${dayExpr}) AS mx FROM records WHERE ${notNull}`
    );
    const dateRange = {
      min: rangeRes.rows[0]?.mn ? String(rangeRes.rows[0].mn) : null,
      max: rangeRes.rows[0]?.mx ? String(rangeRes.rows[0].mx) : null,
    };

    return NextResponse.json({
      params: { dateKey, granularity, product: useProduct ? product : "all" },
      period: periodInfo,
      totals,
      timeseries,
      breakdowns,
      products,
      dateRange,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "query failed" }, { status: 500 });
  }
}
