# レンタル売上ダッシュボード

kintone アプリ10 のデータ（Turso に格納）から、**日毎の売上・販売数**を可視化する Next.js (App Router) ダッシュボード。

## 機能

- **日付軸の切替**: 受注日（作成日時）／ 納品日
- **集計単位の切替**: 日別 ／ 月別
- **分類軸の切替**: 手配種別 ／ レンタル機材 ／ 貸出先法人
- KPI: 売上合計（税抜）・販売数・平均単価・取引法人数
- 時系列グラフ（売上=棒, 販売数=折れ線）＋ 分類別の売上ランキング・明細表

> 注: kintone の「ステータス」項目は全レコードで空（プロセス管理未設定）のため、分類軸には実データのある項目を採用しています。

## セットアップ

```bash
npm install
```

### 環境変数

`.env`（Git管理外）に Turso 接続情報を記述します。`.env.example` を参考にしてください。

```
TURSO_DATABASE_URL=libsql://kintone-app10-rikitomorikawa.aws-ap-northeast-1.turso.io
TURSO_AUTH_TOKEN=<DB用トークン>
```

## ローカル起動

```bash
npm run dev
```

http://localhost:3000 を開く。

## 構成

- `app/page.tsx` … ダッシュボードUI（クライアント、Recharts）
- `app/api/stats/route.ts` … 集計API（サーバー側でTursoに接続。トークンはブラウザに出ません）
- `lib/db.ts` … libSQL クライアント

## データ更新

現状は取込時点のスナップショットです。kintone の最新を反映するには別途同期スクリプトで Turso を更新してください。
