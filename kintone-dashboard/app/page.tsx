"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

type DateKey = "created" | "delivery";
type Granularity = "day" | "month";
type DimKey = "arrange" | "equip" | "corp";

type BreakdownRow = { key: string; revenue: number; count: number };

type Stats = {
  totals: { revenue: number; count: number; corps: number; avg: number };
  timeseries: { date: string; revenue: number; count: number }[];
  breakdowns: Record<DimKey, BreakdownRow[]>;
  products: string[];
  dateRange: { min: string | null; max: string | null };
};

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const num = (n: number) => n.toLocaleString("ja-JP");
const pad2 = (n: number) => String(n).padStart(2, "0");

// 白テーマ用カラー
const C = {
  grid: "#e2e5ea",
  axis: "#6b7280",
  revenue: "#2563eb",
  count: "#059669",
  tooltipBg: "#ffffff",
  tooltipBorder: "#e2e5ea",
  tooltipText: "#1c2330",
};

const DATE_LABEL: Record<DateKey, string> = {
  created: "受注日（作成日時）",
  delivery: "納品日",
};
const DIM_LABEL: Record<DimKey, string> = {
  arrange: "手配種別",
  equip: "レンタル機材",
  corp: "貸出先法人",
};
// 画面に縦並びで表示する分類軸の順序: 機材 → 法人 → 手配
const DIM_ORDER: DimKey[] = ["equip", "corp", "arrange"];

// 年度（4月始まり）。月は1-12。
const fiscalYearOf = (y: number, m: number) => (m >= 4 ? y : y - 1);

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? "active" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// 1分類軸ぶんの「横棒グラフ＋明細テーブル」セクション
function BreakdownSection({
  label,
  rows,
  totalRevenue,
  periodTitle,
}: {
  label: string;
  rows: BreakdownRow[];
  totalRevenue: number;
  periodTitle: string;
}) {
  return (
    <div className="grid-2">
      <div className="panel">
        <h2>
          {label}別 売上（{periodTitle}）
        </h2>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart
            layout="vertical"
            data={rows.slice(0, 12)}
            margin={{ left: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
            <XAxis
              type="number"
              stroke={C.axis}
              fontSize={11}
              tickFormatter={(v) => (v / 10000).toFixed(0) + "万"}
            />
            <YAxis
              type="category"
              dataKey="key"
              stroke={C.axis}
              fontSize={11}
              width={140}
            />
            <Tooltip
              contentStyle={{
                background: C.tooltipBg,
                border: `1px solid ${C.tooltipBorder}`,
                borderRadius: 8,
                color: C.tooltipText,
              }}
              formatter={(value: any) => [yen(Number(value)), "売上"]}
            />
            <Bar
              dataKey="revenue"
              name="売上"
              fill={C.revenue}
              radius={[0, 3, 3, 0]}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h2>
          {label}別 明細（{periodTitle}）
        </h2>
        {rows.length === 0 ? (
          <div className="loading">この期間のデータはありません</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{label}</th>
                <th className="num">件数</th>
                <th className="num">売上（税抜）</th>
                <th className="num">構成比</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.key}>
                  <td>{b.key}</td>
                  <td className="num">{num(b.count)}</td>
                  <td className="num">{yen(b.revenue)}</td>
                  <td className="num">
                    {totalRevenue > 0
                      ? ((b.revenue / totalRevenue) * 100).toFixed(1)
                      : "0.0"}
                    %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  // 初期: 今月（日別）
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;

  const [dateField, setDateField] = useState<DateKey>("created");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [product, setProduct] = useState<string>("all");

  // 日別: dayYear/dayMonth、月別: fiscalYear（独立保持）
  const [dayYear, setDayYear] = useState<number>(curY);
  const [dayMonth, setDayMonth] = useState<number>(curM);
  const [fiscalYear, setFiscalYear] = useState<number>(fiscalYearOf(curY, curM));

  const [data, setData] = useState<Stats | null>(null);
  const [productList, setProductList] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reqYear = granularity === "day" ? dayYear : fiscalYear;

  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      dateField,
      granularity,
      product,
      year: String(reqYear),
      month: String(dayMonth),
    });
    fetch(`/api/stats?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        if (product === "all" && d.products) setProductList(d.products);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [dateField, granularity, product, reqYear, dayMonth]);

  // 年/年度セレクタの選択肢（データ範囲から）
  const { calYears, fiscalYears } = useMemo(() => {
    const min = data?.dateRange?.min;
    const max = data?.dateRange?.max;
    const minY = min ? parseInt(min.slice(0, 4), 10) : curY;
    const maxY = max ? parseInt(max.slice(0, 4), 10) : curY;
    const cal: number[] = [];
    for (let y = minY; y <= maxY; y++) cal.push(y);
    if (!cal.includes(dayYear)) cal.push(dayYear);
    cal.sort((a, b) => a - b);

    const fyMin = min ? fiscalYearOf(parseInt(min.slice(0, 4), 10), parseInt(min.slice(5, 7), 10)) : curY;
    const fyMax = max ? fiscalYearOf(parseInt(max.slice(0, 4), 10), parseInt(max.slice(5, 7), 10)) : curY;
    const fy: number[] = [];
    for (let y = fyMin; y <= fyMax; y++) fy.push(y);
    if (!fy.includes(fiscalYear)) fy.push(fiscalYear);
    fy.sort((a, b) => a - b);
    return { calYears: cal, fiscalYears: fy };
  }, [data?.dateRange, dayYear, fiscalYear, curY]);

  // グラフ用に軸をゼロ埋め（日別=1〜月末 / 月別=4〜翌3月）
  const chartData = useMemo(() => {
    const map = new Map<string, { revenue: number; count: number }>();
    (data?.timeseries ?? []).forEach((p) =>
      map.set(p.date, { revenue: p.revenue, count: p.count })
    );
    if (granularity === "day") {
      const days = new Date(dayYear, dayMonth, 0).getDate(); // 月末日
      return Array.from({ length: days }, (_, i) => {
        const d = i + 1;
        const key = `${dayYear}-${pad2(dayMonth)}-${pad2(d)}`;
        const v = map.get(key) ?? { revenue: 0, count: 0 };
        return { label: `${dayMonth}/${d}`, ...v };
      });
    }
    // 月別: 4月〜翌3月
    return Array.from({ length: 12 }, (_, i) => {
      const cm = 4 + i;
      const yr = cm <= 12 ? fiscalYear : fiscalYear + 1;
      const mm = cm <= 12 ? cm : cm - 12;
      const key = `${yr}-${pad2(mm)}`;
      const v = map.get(key) ?? { revenue: 0, count: 0 };
      return { label: `${mm}月`, ...v };
    });
  }, [data?.timeseries, granularity, dayYear, dayMonth, fiscalYear]);

  // 月の前後移動（年をまたぐ場合は年も調整）
  const moveMonth = (dir: -1 | 1) => {
    let m = dayMonth + dir;
    let y = dayYear;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setDayMonth(m);
    setDayYear(y);
  };

  const periodTitle =
    granularity === "day"
      ? `${dayYear}年${dayMonth}月（日別）`
      : `${fiscalYear}年度（${fiscalYear}/4〜${fiscalYear + 1}/3）`;

  return (
    <div className="container">
      <h1>レンタル売上ダッシュボード</h1>
      <div className="subtitle">
        売上（税抜：機器代+配送費-調整額）と販売数
      </div>

      <div className="note">
        ※ 最新データに1日1回自動更新
      </div>

      <div className="controls">
        <div className="control-group">
          <label>日付軸</label>
          <Segmented<DateKey>
            value={dateField}
            onChange={setDateField}
            options={[
              { value: "created", label: "受注日" },
              { value: "delivery", label: "納品日" },
            ]}
          />
        </div>
        <div className="control-group">
          <label>集計単位</label>
          <Segmented<Granularity>
            value={granularity}
            onChange={setGranularity}
            options={[
              { value: "day", label: "日別" },
              { value: "month", label: "月別（年度）" },
            ]}
          />
        </div>

        <div className="control-group">
          <label>{granularity === "day" ? "年" : "年度"}</label>
          {granularity === "day" ? (
            <select
              className="period-select"
              value={dayYear}
              onChange={(e) => setDayYear(Number(e.target.value))}
            >
              {calYears.map((y) => (
                <option key={y} value={y}>
                  {y}年
                </option>
              ))}
            </select>
          ) : (
            <select
              className="period-select"
              value={fiscalYear}
              onChange={(e) => setFiscalYear(Number(e.target.value))}
            >
              {fiscalYears.map((y) => (
                <option key={y} value={y}>
                  {y}年度
                </option>
              ))}
            </select>
          )}
        </div>

        {granularity === "day" && (
          <div className="control-group">
            <label>月</label>
            <div className="period-nav">
              <button onClick={() => moveMonth(-1)} aria-label="前月">
                ◀
              </button>
              <span className="month-display">{dayMonth}月</span>
              <button onClick={() => moveMonth(1)} aria-label="翌月">
                ▶
              </button>
            </div>
          </div>
        )}

        <div className="control-group">
          <label>商品（機材）で絞り込み</label>
          <select
            className="product-select"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
          >
            <option value="all">全商品</option>
            {productList.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="error">エラー: {error}</div>}

      {data && (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">
                売上合計（税抜）{product !== "all" ? " / " + product : ""}
              </div>
              <div className="kpi-value">{yen(data.totals.revenue)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">販売数（件）</div>
              <div className="kpi-value">
                {num(data.totals.count)}
                <span className="kpi-unit">件</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">平均単価</div>
              <div className="kpi-value">{yen(data.totals.avg)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">取引法人数</div>
              <div className="kpi-value">
                {num(data.totals.corps)}
                <span className="kpi-unit">社</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>
              {DATE_LABEL[dateField]}・{periodTitle}の売上と販売数（折れ線）
              {product !== "all" ? `　【${product}】` : ""}
              {loading ? "　…更新中" : ""}
            </h2>
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                <XAxis dataKey="label" stroke={C.axis} fontSize={11} />
                <YAxis
                  yAxisId="left"
                  stroke={C.revenue}
                  fontSize={11}
                  tickFormatter={(v) => "¥" + (v / 10000).toFixed(0) + "万"}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke={C.count}
                  fontSize={11}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: C.tooltipBg,
                    border: `1px solid ${C.tooltipBorder}`,
                    borderRadius: 8,
                    color: C.tooltipText,
                  }}
                  formatter={(value: any, name: any) =>
                    name === "売上"
                      ? [yen(Number(value)), "売上"]
                      : [num(Number(value)) + "件", "販売数"]
                  }
                />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="revenue"
                  name="売上"
                  stroke={C.revenue}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="count"
                  name="販売数"
                  stroke={C.count}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {DIM_ORDER.map((dk) => (
            <BreakdownSection
              key={dk}
              label={DIM_LABEL[dk]}
              rows={data.breakdowns[dk] ?? []}
              totalRevenue={data.totals.revenue}
              periodTitle={periodTitle}
            />
          ))}
        </>
      )}
    </div>
  );
}
