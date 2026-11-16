// MoveLog v2 API — Netlify Functions + Netlify Blobs
// すべてのリクエストはヘッダー x-movelog-key が環境変数 MOVELOG_KEY と一致する必要がある
import { getStore } from '@netlify/blobs';

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const todayJST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/^\.netlify\/functions\/api\/?/, '');
  const parts = path.split('/').filter(Boolean);

  // ---- 認証 ----
  const expected = process.env.MOVELOG_KEY;
  if (!expected) return json(500, { error: 'サーバーに MOVELOG_KEY が設定されていません' });
  const key = req.headers.get('x-movelog-key') || url.searchParams.get('key');
  if (key !== expected) return json(401, { error: '合言葉（MOVELOG_KEY）が違います' });

  const store = getStore({ name: 'movelog', consistency: 'strong' });

  try {
    // ---- 疎通確認 ----
    if (parts[0] === 'ping') return json(200, { ok: true });

    // ---- 日別データ ----
    if (parts[0] === 'days' && req.method === 'GET') {
      const from = url.searchParams.get('from') || '0000-00-00';
      const to = url.searchParams.get('to') || '9999-99-99';
      const { blobs } = await store.list({ prefix: 'day/' });
      const keys = blobs.map((b) => b.key).filter((k) => {
        const d = k.slice(4);
        return d >= from && d <= to;
      });
      const days = await Promise.all(keys.map((k) => store.get(k, { type: 'json' })));
      return json(200, days.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date)));
    }

    if (parts[0] === 'day' && DATE_RE.test(parts[1] || '')) {
      const k = `day/${parts[1]}`;
      if (req.method === 'GET') return json(200, (await store.get(k, { type: 'json' })) || { date: parts[1] });
      if (req.method === 'PUT') {
        const body = await req.json();
        body.date = parts[1];
        body.updatedAt = new Date().toISOString();
        await store.setJSON(k, body);
        return json(200, body);
      }
      if (req.method === 'DELETE') {
        await store.delete(k);
        return json(200, { ok: true });
      }
    }

    // ---- iPhoneショートカットからのヘルスケア受信 ----
    if (parts[0] === 'health' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const date = DATE_RE.test(b.date || '') ? b.date : todayJST();
      const k = `day/${date}`;
      const day = (await store.get(k, { type: 'json' })) || { date };
      const health = {
        activeKcal: num(b.activeKcal),
        restingKcal: num(b.restingKcal),
        steps: num(b.steps),
        walkRunKm: num(b.walkRunKm),
        cycleKm: num(b.cycleKm),
        swimM: num(b.swimM),
        workouts: Array.isArray(b.workouts) ? b.workouts : undefined,
        syncedAt: new Date().toISOString(),
      };
      day.health = { ...(day.health || {}), ...Object.fromEntries(Object.entries(health).filter(([, v]) => v !== null && v !== undefined)) };
      const w = num(b.weight);
      if (w && w > 20 && w < 300 && !day.weight) day.weight = w; // 手入力の体重を優先
      day.updatedAt = new Date().toISOString();
      await store.setJSON(k, day);
      return json(200, { ok: true, date, health: day.health });
    }

    // ---- プロフィール / マイメニュー ----
    if ((parts[0] === 'profile' || parts[0] === 'menu') && parts.length === 1) {
      if (req.method === 'GET') return json(200, (await store.get(parts[0], { type: 'json' })) || (parts[0] === 'menu' ? [] : {}));
      if (req.method === 'PUT') {
        const body = await req.json();
        await store.setJSON(parts[0], body);
        return json(200, body);
      }
    }

    // ---- 食事のkcal推定（写真 and/or 文章） ----
    if (parts[0] === 'analyze' && req.method === 'POST') {
      const b = await req.json();
      return json(200, await analyzeMeal(b));
    }

    return json(404, { error: 'not found' });
  } catch (e) {
    return json(500, { error: e.message || String(e) });
  }
};

// ================= 食事解析 =================
const SYSTEM = `あなたは日本の食事に詳しい管理栄養士です。食事の写真やメモから、料理ごとに量(g)とカロリー(kcal)を推定します。
ルール:
- 日本の一般的な店・家庭の分量を基準にする。チェーン店やコンビニ商品と分かる場合はその公表値に寄せる。
- 写っている器・箸・手などの大きさから量を見積もる。
- 「大盛り」「半分残した」「油少なめ」などメモの指示を必ず反映する。
- 迷ったら少なめではなく、現実的な中央値を選ぶ（過小評価しない）。
- 出力は次のJSONのみ。説明文やコードブロックは付けない。
{"items":[{"name":"料理名","grams":数値,"kcal":数値}],"total":数値,"confidence":"high|medium|low","comment":"一言（20字以内）"}`;

async function analyzeMeal({ imageBase64, mediaType, note, history }) {
  if (!imageBase64 && !note) throw new Error('写真かメモのどちらかが必要です');
  let userText = note ? `メモ: ${note}` : 'メモ: なし';
  if (Array.isArray(history) && history.length) {
    userText += `\n\n参考: この人が過去に自分で確定した食事の実績（推定の目安に使う）\n` +
      history.slice(0, 30).map((h) => `- ${h.name}: ${h.kcal}kcal`).join('\n');
  }

  let text;
  if (process.env.ANTHROPIC_API_KEY) {
    const content = [];
    if (imageBase64) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } });
    content.push({ type: 'text', text: userText });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: 'user', content }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'Claude APIエラー');
    text = d.content?.find((c) => c.type === 'text')?.text || '';
  } else if (process.env.OPENAI_API_KEY) {
    const content = [];
    if (imageBase64) content.push({ type: 'image_url', image_url: { url: `data:${mediaType || 'image/jpeg'};base64,${imageBase64}` } });
    content.push({ type: 'text', text: userText });
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'OpenAI APIエラー');
    text = d.choices?.[0]?.message?.content || '';
  } else {
    throw new Error('ANTHROPIC_API_KEY か OPENAI_API_KEY を設定してください');
  }

  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('解析結果を読み取れませんでした');
  const out = JSON.parse(m[0]);
  out.items = (out.items || []).map((i) => ({ name: String(i.name || '不明'), grams: Math.round(num(i.grams) || 0), kcal: Math.round(num(i.kcal) || 0) }));
  out.total = out.items.reduce((s, i) => s + i.kcal, 0);
  return out;
}

export const config = { path: ['/api/*'] };
