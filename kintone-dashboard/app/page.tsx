"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
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

type Stats = {
  totals: { revenue: number; count: number; corps: number; avg: number };
  timeseries: { date: string; revenue: number; count: number }[];
  breakdown: { key: string; revenue: number; count: number }[];
};

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const num = (n: number) => n.toLocaleString("ja-JP");

const DATE_LABEL: Record<DateKey, string> = {
  created: "受注日（作成日時）",
  delivery: "納品日",
};
const DIM_LABEL: Record<DimKey, string> = {
  arrange: "手配種別",
  equip: "レンタル機材",
  corp: "貸出先法人",
};

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

export default function Dashboard() {
  const [dateField, setDateField] = useState<DateKey>("created");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [dimension, setDimension] = useState<DimKey>("arrange");

  const [data, setData] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ dateField, granularity, dimension });
    fetch(`/api/stats?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [dateField, granularity, dimension]);

  return (
    <div className="container">
      <h1>レンタル売上ダッシュボード</h1>
      <div className="subtitle">
        kintone アプリ10 → Turso / 売上（税抜：機器代+配送費-調整額）と販売数
      </div>

      <div className="note">
        ※ kintoneの「ステータス」項目は全レコードで空のため、分類軸は実データのある「手配種別／レンタル機材／貸出先法人」を採用しています。
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
              { value: "month", label: "月別" },
            ]}
          />
        </div>
        <div className="control-group">
          <label>分類軸</label>
          <Segmented<DimKey>
            value={dimension}
            onChange={setDimension}
            options={[
              { value: "arrange", label: "手配種別" },
              { value: "equip", label: "機材" },
              { value: "corp", label: "法人" },
            ]}
          />
        </div>
      </div>

      {loading && <div className="loading">読み込み中…</div>}
      {error && <div className="error">エラー: {error}</div>}

      {data && !loading && (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">売上合計（税抜）</div>
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
              {DATE_LABEL[dateField]}・{granularity === "day" ? "日別" : "月別"}
              の売上と販売数
            </h2>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={data.timeseries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3e" />
                <XAxis dataKey="date" stroke="#9aa3b2" fontSize={11} />
                <YAxis
                  yAxisId="left"
                  stroke="#4f8cff"
                  fontSize={11}
                  tickFormatter={(v) => "¥" + (v / 10000).toFixed(0) + "万"}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#34d399"
                  fontSize={11}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1f2331",
                    border: "1px solid #2a2f3e",
                    borderRadius: 8,
                    color: "#e6e9ef",
                  }}
                  formatter={(value: any, name: any) =>
                    name === "売上"
                      ? [yen(Number(value)), "売上"]
                      : [num(Number(value)) + "件", "販売数"]
                  }
                />
                <Legend />
                <Bar
                  yAxisId="left"
                  dataKey="revenue"
                  name="売上"
                  fill="#4f8cff"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="count"
                  name="販売数"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="grid-2">
            <div className="panel">
              <h2>{DIM_LABEL[dimension]}別 売上</h2>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart
                  layout="vertical"
                  data={data.breakdown.slice(0, 12)}
                  margin={{ left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3e" />
                  <XAxis
                    type="number"
                    stroke="#9aa3b2"
                    fontSize={11}
                    tickFormatter={(v) => (v / 10000).toFixed(0) + "万"}
                  />
                  <YAxis
                    type="category"
                    dataKey="key"
                    stroke="#9aa3b2"
                    fontSize={11}
                    width={140}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1f2331",
                      border: "1px solid #2a2f3e",
                      borderRadius: 8,
                      color: "#e6e9ef",
                    }}
                    formatter={(value: any) => [yen(Number(value)), "売上"]}
                  />
                  <Bar dataKey="revenue" name="売上" fill="#4f8cff" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <h2>{DIM_LABEL[dimension]}別 明細</h2>
              <table>
                <thead>
                  <tr>
                    <th>{DIM_LABEL[dimension]}</th>
                    <th className="num">件数</th>
                    <th className="num">売上（税抜）</th>
                    <th className="num">構成比</th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map((b) => (
                    <tr key={b.key}>
                      <td>{b.key}</td>
                      <td className="num">{num(b.count)}</td>
                      <td className="num">{yen(b.revenue)}</td>
                      <td className="num">
                        {data.totals.revenue > 0
                          ? ((b.revenue / data.totals.revenue) * 100).toFixed(1)
                          : "0.0"}
                        %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
