# MoveLog v2 セットアップ手順

## 1. GitHub（Yusuke-AUU/movelog）を入れ替える
- 削除するもの：`script.js`、`netlify/functions/analyze.js`、`favicon.svg`、`favicon.jpeg`
- 上書き・追加するもの：`index.html`、`style.css`、`app.js`、`package.json`、`netlify.toml`、`netlify/functions/api.mjs`、`SETUP.md`
- アイコンは新デザイン（M＋下がる線）に差し替え：favicon.svg / favicon-32.png / favicon-192.png / favicon-512.png / apple-touch-icon.png / site.webmanifest を上書き・追加

## 2. Netlifyに環境変数を入れる
Project configuration → Environment variables

| Key | 値 |
|---|---|
| `MOVELOG_KEY` | 好きな合言葉（英数字20文字以上推奨。アプリとショートカットで使う） |
| `ANTHROPIC_API_KEY` | （任意）入れると食事解析がClaudeになる。無ければ今の `OPENAI_API_KEY` で動く |

入れたら Deploys → Trigger deploy → Deploy site。

## 3. アプリを開く
- 初回だけ合言葉を入力
- 設定 → 「この端末の旧MoveLogデータをクラウドへ移す」で旧データを移行（旧データがある端末だけボタンが出ます）
- プロフィール（年齢・身長・目標体重）を保存

## 4. iPhoneのショートカット「MoveLog同期」を作る
ショートカットApp → ＋ → 名前を **MoveLog同期**（この名前でアプリのボタンから起動します）

1. **ヘルスケアのサンプルを検索**
   - 種類：アクティブエネルギー
   - 開始日：今日
   - ソース：Garmin Connect（iPhoneとGarminの二重計上を防ぐため）
2. **統計を計算**：合計 → 変数名「active」
3. 1〜2を繰り返し（ソースはGarmin Connect）
   - 歩数 → 「steps」
   - 歩行+ランニングの距離 → 「km」
   - サイクリングの距離 → 「bike」（使う人だけ）
   - 水泳の距離 → 「swim」（単位はm）
4. **日付を整形**：現在の日付、カスタム形式 `yyyy-MM-dd` → 「today」
5. **辞書**
   - date：today
   - activeKcal：active
   - steps：steps
   - walkRunKm：km
   - cycleKm：bike
   - swimM：swim
6. **URLの内容を取得**
   - URL：`https://（MoveLogのURL）/api/health`
   - 方法：POST
   - ヘッダ：`x-movelog-key` ＝ 合言葉
   - 本文を要求：JSON → 5の辞書
7. **URLを開く**：`https://（MoveLogのURL）/`（手動実行した時にアプリへ戻る）

### 毎晩の自動実行
ショートカットApp → オートメーション → ＋ → 時刻：23:50・毎日 → 「すぐに実行」 → MoveLog同期

※ 初回はヘルスケアへのアクセス許可を求められるので「許可」。
※ 7の「URLを開く」は自動実行時は不要なら外してOK。

## 計算のしくみ
- 消費 ＝ 基礎代謝（Mifflin-St Jeor式）＋ アクティブエネルギー（Garmin実測）＋ 手入力の運動
- ヘルスケア未同期の日は 基礎代謝×1.2 ＋ 手入力の運動 で推定
- 理論値 ＝（摂取 − 消費）÷ 1kgあたりkcal（初期値7000＝700kcalで0.1kg）
- 食事を記録していない日は収支に入れない
- 直近28日で「食事10日以上・体重4回以上」がそろうと、理論値と実測体重のズレから1日あたりの補正kcalを自動計算し、ホームの理論値に反映
