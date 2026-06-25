import type { Client } from "@libsql/client";

/**
 * kintone（アプリ10）→ Turso records テーブルへの差分同期。
 *
 * - 差分基準: records の MAX("更新日時") をウォーターマークに、kintone を
 *   `更新日時 >= "<wm>"` で取得（境界レコードはUPSERTで冪等に再取込）。
 * - 主キー record_id ($id) で UPSERT するため、新規・更新どちらも反映される。
 * - 列名は kintone フィールドコードと 1:1（$id→record_id, $revision→revision のみ別名）。
 *   既存テーブルに存在する列だけを書き込む（未知フィールドは無視）。
 */

type KintoneField = { type: string; value: any };
type KintoneRecord = Record<string, KintoneField>;

const PAGE = 500; // kintone 1リクエストあたり最大500件
const OFFSET_CAP = 10000; // kintone offset の上限（暴走防止も兼ねる）

/** 既存スナップショットと同じ規則で kintone の値を SQL 格納値へ変換 */
function serialize(field: KintoneField): string | number | null {
  const { type, value } = field;
  if (value === null || value === undefined) return null;

  switch (type) {
    // 作成者/更新者: 表示名のみ格納
    case "CREATOR":
    case "MODIFIER":
      return value?.name ?? null;

    // 配列系: 空なら NULL、非空は JSON 文字列
    case "CHECK_BOX":
    case "MULTI_SELECT":
    case "CATEGORY":
    case "SUBTABLE":
      return Array.isArray(value) && value.length ? JSON.stringify(value) : null;
    case "FILE":
      return Array.isArray(value) && value.length
        ? JSON.stringify(value.map((f: any) => f.name))
        : null;
    case "USER_SELECT":
    case "ORGANIZATION_SELECT":
    case "GROUP_SELECT":
      return Array.isArray(value) && value.length
        ? JSON.stringify(value.map((u: any) => u.name))
        : null;

    // 数値系: 空文字は NULL
    case "NUMBER":
    case "CALC":
    case "RECORD_NUMBER":
    case "__ID__":
    case "__REVISION__":
      return value === "" ? null : Number(value);

    // それ以外（テキスト/日付/時刻/ドロップダウン等）: 空文字は NULL
    default:
      return value === "" ? null : value;
  }
}

/** kintone REST API から1ページ取得 */
async function fetchPage(
  base: string,
  appId: string,
  token: string,
  query: string
): Promise<KintoneRecord[]> {
  const url = `${base}/k/v1/records.json?app=${encodeURIComponent(
    appId
  )}&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "X-Cybozu-API-Token": token },
    // Vercel/Next のキャッシュを避ける
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`kintone API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { records: KintoneRecord[] };
  return json.records ?? [];
}

export type SyncResult = {
  watermark: string | null;
  fetched: number;
  upserted: number;
  newWatermark: string | null;
};

export async function runSync(db: Client): Promise<SyncResult> {
  const subdomain = process.env.KINTONE_SUBDOMAIN;
  const appId = process.env.KINTONE_APP_ID;
  const token = process.env.KINTONE_API_TOKEN;
  if (!subdomain || !appId || !token) {
    throw new Error(
      "KINTONE_SUBDOMAIN / KINTONE_APP_ID / KINTONE_API_TOKEN が設定されていません"
    );
  }
  const base = `https://${subdomain}.cybozu.com`;

  // 書き込み対象の列集合（テーブルに実在する列のみ採用）
  const info = await db.execute("PRAGMA table_info(records)");
  const columns = new Set(info.rows.map((r) => String(r.name)));

  // ウォーターマーク（最新の更新日時）
  const wmRes = await db.execute('SELECT MAX("更新日時") AS wm FROM records');
  const watermark = wmRes.rows[0]?.wm ? String(wmRes.rows[0].wm) : null;

  const filter = watermark ? `更新日時 >= "${watermark}" ` : "";

  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  let newWatermark = watermark;

  while (offset < OFFSET_CAP) {
    const query = `${filter}order by 更新日時 asc limit ${PAGE} offset ${offset}`;
    const records = await fetchPage(base, appId, token, query);
    if (records.length === 0) break;
    fetched += records.length;

    for (const rec of records) {
      const row: Record<string, string | number | null> = {};
      for (const [code, field] of Object.entries(rec)) {
        let col = code;
        if (code === "$id") col = "record_id";
        else if (code === "$revision") col = "revision";
        if (!columns.has(col)) continue; // 未知フィールドは無視
        row[col] = serialize(field);
      }
      if (row.record_id == null) continue; // PK必須

      const cols = Object.keys(row);
      const placeholders = cols.map(() => "?").join(", ");
      const quoted = cols.map((c) => `"${c}"`).join(", ");
      const updates = cols
        .filter((c) => c !== "record_id")
        .map((c) => `"${c}" = excluded."${c}"`)
        .join(", ");

      await db.execute({
        sql: `INSERT INTO records (${quoted}) VALUES (${placeholders})
              ON CONFLICT(record_id) DO UPDATE SET ${updates}`,
        args: cols.map((c) => row[c]),
      });
      upserted++;

      const u = rec["更新日時"]?.value;
      if (typeof u === "string" && (!newWatermark || u > newWatermark)) {
        newWatermark = u;
      }
    }

    if (records.length < PAGE) break;
    offset += PAGE;
  }

  return { watermark, fetched, upserted, newWatermark };
}
