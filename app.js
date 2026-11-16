/* MoveLog v2 — 楽に、理論値と実測で体重管理 */
'use strict';

// ======================== 定数 ========================
const SHORTCUT_NAME = 'MoveLog同期';
const ACTIVITIES = [
  { id: 'ballet', label: 'バレエ', met: 4.8 },
  { id: 'trampoline', label: 'トランポリン', met: 4.5 },
  { id: 'swim', label: 'スイム', met: 8.0 },
  { id: 'bike', label: 'バイク', met: 7.5 },
  { id: 'run', label: 'ラン', met: 9.8 },
  { id: 'walk', label: 'ウォーキング', met: 3.5 },
  { id: 'workout', label: '筋トレ', met: 5.0 },
  { id: 'other', label: 'その他', met: 4.0 },
];
const LS = { key: 'ml2:key', cache: 'ml2:days', profile: 'ml2:profile', menu: 'ml2:menu', photo: 'profilePhoto' };

// ======================== 状態 ========================
const S = {
  key: localStorage.getItem(LS.key) || '',
  days: {},            // date -> record
  profile: {},
  menu: [],
  date: ymd(new Date()),
  range: 30,
  draft: { image: null, mediaType: null },
  charts: {},
};
try { S.days = JSON.parse(localStorage.getItem(LS.cache) || '{}'); } catch { S.days = {}; }
try { S.profile = JSON.parse(localStorage.getItem(LS.profile) || '{}'); } catch {}
try { S.menu = JSON.parse(localStorage.getItem(LS.menu) || '[]'); } catch {}

// ======================== ユーティリティ ========================
function ymd(d) { // ローカル日付（旧版の toISOString による日付ズレを解消）
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function diffDays(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 864e5); }
const WD = ['日', '月', '火', '水', '木', '金', '土'];
function jpDate(s, withWd = true) { const d = parseYmd(s); return `${d.getMonth() + 1}月${d.getDate()}日${withWd ? `（${WD[d.getDay()]}）` : ''}`; }
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
const sign = (n, d = 0) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
function loading(on, text = '解析中…') { $('loading').hidden = !on; $('loadingText').textContent = text; }
const ICON = {
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  act: '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
};

// ======================== API ========================
async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-movelog-key': S.key, ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `通信エラー (${res.status})`);
  return data;
}
function persistCache() {
  localStorage.setItem(LS.cache, JSON.stringify(S.days));
  localStorage.setItem(LS.profile, JSON.stringify(S.profile));
  localStorage.setItem(LS.menu, JSON.stringify(S.menu));
}
async function saveDay(date) {
  const rec = S.days[date];
  persistCache();
  try { await api(`day/${date}`, { method: 'PUT', body: JSON.stringify(rec) }); }
  catch (e) { toast('クラウド保存に失敗：' + e.message); }
}
async function saveMenu() { persistCache(); try { await api('menu', { method: 'PUT', body: JSON.stringify(S.menu) }); } catch (e) { toast('保存失敗：' + e.message); } }
async function saveProfileRemote() { persistCache(); try { await api('profile', { method: 'PUT', body: JSON.stringify(S.profile) }); } catch (e) { toast('保存失敗：' + e.message); } }
async function pullAll() {
  const [days, profile, menu] = await Promise.all([api('days'), api('profile'), api('menu')]);
  S.days = {}; days.forEach((d) => (S.days[d.date] = d));
  S.profile = profile || {}; S.menu = Array.isArray(menu) ? menu : [];
  persistCache();
}
function day(date) { return S.days[date] || (S.days[date] = { date }); }

// ======================== 計算 ========================
const P = () => ({ age: 40, gender: 'male', height: 170, kcalPerKg: 7000, autoCorr: true, ...S.profile });

function latestWeight(upTo) {
  const keys = Object.keys(S.days).filter((k) => k <= upTo && S.days[k].weight).sort();
  return keys.length ? S.days[keys[keys.length - 1]].weight : null;
}
function bmr(weight) { // Mifflin-St Jeor（安静時代謝）
  const p = P(); const w = weight || 70;
  const base = 10 * w + 6.25 * (+p.height || 170) - 5 * (+p.age || 40);
  return Math.round(p.gender === 'female' ? base - 161 : base + 5);
}
function intakeOf(rec) {
  if (rec.meals && rec.meals.length) return rec.meals.reduce((s, m) => s + (+m.kcal || 0), 0);
  return null; // 未記録日は収支に入れない（旧シートの「空欄＝−2000kcal」問題の対策）
}
function manualKcal(rec) { return (rec.manual || []).reduce((s, a) => s + (+a.kcal || 0), 0); }
function stats(date) {
  const rec = S.days[date] || { date };
  const w = rec.weight || latestWeight(date) || 70;
  const base = bmr(w);
  const h = rec.health || {};
  const hasHealth = h.activeKcal != null;
  const manual = manualKcal(rec);
  // ヘルスケアあり: 安静時代謝 + アクティブ（歩行・家事・運動すべて実測）
  // ヘルスケアなし: 安静時代謝×1.2（日常生活の推定）+ 手入力の運動
  const daily = hasHealth ? Math.round(+h.activeKcal) : Math.round(base * 0.2);
  const burn = base + daily + manual;
  const intake = intakeOf(rec);
  const balance = intake == null ? null : intake - burn;
  return { rec, base, daily, manual, burn, intake, balance, hasHealth, kg: balance == null ? null : balance / P().kcalPerKg };
}

// 実測体重の推移から「あなた専用の補正値」を学習する
function calibration(endDate, windowDays = 28) {
  const start = addDays(endDate, -windowDays + 1);
  const logged = [], weights = [];
  for (let i = 0; i < windowDays; i++) {
    const d = addDays(start, i); const s = stats(d);
    if (s.balance != null) logged.push(s.balance);
    if (S.days[d]?.weight) weights.push([i, S.days[d].weight]);
  }
  if (logged.length < 10 || weights.length < 4 || weights[weights.length - 1][0] - weights[0][0] < 10) {
    return { ready: false, logged: logged.length, weighIns: weights.length, start };
  }
  const n = weights.length, mx = weights.reduce((s, p) => s + p[0], 0) / n, my = weights.reduce((s, p) => s + p[1], 0) / n;
  const slope = weights.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / weights.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const K = P().kcalPerKg;
  const meanBal = logged.reduce((a, b) => a + b, 0) / logged.length;
  const theorySlope = meanBal / K;
  let offset = (slope - theorySlope) * K;
  offset = Math.max(-1000, Math.min(1000, offset));
  return { ready: true, offset: Math.round(offset), actualWeek: slope * 7, theoryWeek: theorySlope * 7, logged: logged.length, weighIns: n, start };
}

// ======================== ナビゲーション ========================
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelector('.datenav').style.visibility = name === 'home' ? 'visible' : 'hidden';
  window.scrollTo({ top: 0 });
  if (name === 'trend') renderTrend();
  if (name === 'week') renderWeeks();
  if (name === 'settings') renderSettings();
}
function setDate(d) {
  if (d > ymd(new Date())) return;
  S.date = d; renderHome();
}

// ======================== ホーム ========================
function renderHome() {
  const today = ymd(new Date());
  const dd = parseYmd(S.date);
  $('dateLabel').textContent = `${S.date === today ? '今日 ' : ''}${dd.getMonth() + 1}/${dd.getDate()}（${WD[dd.getDay()]}）`;
  $('nextDay').style.opacity = S.date >= today ? .25 : 1;

  const s = stats(S.date);
  const p = P();
  const cal = calibration(S.date);
  const useCorr = p.autoCorr && cal.ready;

  // 収支
  const big = $('balanceBig');
  if (s.balance == null) {
    big.textContent = '0'; big.className = 'big empty';
    $('theorySub').textContent = '食事を記録すると理論値が出ます';
  } else {
    const bal = useCorr ? s.balance + cal.offset : s.balance;
    big.textContent = sign(bal); big.className = 'big ' + (bal <= 0 ? 'good' : 'warn');
    const kg = bal / p.kcalPerKg;
    $('theorySub').innerHTML = `理論値 <b>${sign(kg, 2)} kg</b>` + (useCorr ? `<span class="muted">（補正 ${sign(cal.offset)}kcal 込み・補正前 ${sign(s.kg, 2)}kg）</span>` : '');
  }
  const pill = $('modePill');
  if (s.hasHealth) { pill.textContent = S.date === today ? 'ヘルスケア連携・途中経過' : 'ヘルスケア連携'; pill.className = 'pill good'; }
  else { pill.textContent = '消費は推定'; pill.className = 'pill'; }

  const maxV = Math.max(s.intake || 0, s.burn, 1);
  $('barIntake').style.width = `${((s.intake || 0) / maxV) * 100}%`;
  $('barBurn').style.width = `${(s.burn / maxV) * 100}%`;
  $('intakeVal').textContent = s.intake == null ? '—' : fmt(s.intake);
  $('burnVal').textContent = fmt(s.burn);
  $('burnBreakdown').textContent =
    `消費の内訳：基礎代謝 ${fmt(s.base)} ＋ ${s.hasHealth ? 'アクティブ（Garmin/iPhone）' : '日常生活（推定）'} ${fmt(s.daily)}` +
    (s.manual ? ` ＋ 手入力の運動 ${fmt(s.manual)}` : '') + ' kcal';

  // 体重
  const rec = s.rec;
  const wInput = $('weightInput');
  if (document.activeElement !== wInput) wInput.value = rec.weight ? rec.weight.toFixed(1) : (latestWeight(S.date)?.toFixed(1) || '');
  wInput.dataset.recorded = rec.weight ? '1' : '';
  const prevKeys = Object.keys(S.days).filter((k) => k < S.date && S.days[k].weight).sort();
  const prev = prevKeys.length ? S.days[prevKeys[prevKeys.length - 1]] : null;
  let meta = rec.weight ? '記録済み' : '未記録';
  if (rec.weight && prev) meta += `・前回比 ${sign(rec.weight - prev.weight, 1)}kg`;
  if (p.goal && rec.weight) meta += `・目標まで${(rec.weight - p.goal).toFixed(1)}kg`;
  $('weightMeta').textContent = meta;
  $('saveWeight').textContent = rec.weight ? '更新する' : '記録する';

  // 食事
  const meals = rec.meals || [];
  $('mealTotal').textContent = meals.length ? `${fmt(s.intake)} kcal` : '';
  $('mealList').innerHTML = meals.length ? meals.map((m) => `
    <li>
      <div class="thumb">${m.source === 'menu' ? ICON.star : m.source === 'ai' ? ICON.cam : ICON.pen}</div>
      <div class="grow"><div class="title">${esc(m.name)}</div><div class="sub">${esc(m.at || '')}${m.items?.length > 1 ? '・' + m.items.map((i) => esc(i.name)).join('、') : ''}</div></div>
      <div class="kcal">${fmt(m.kcal)}<small>kcal</small></div>
      <button class="del" data-del-meal="${m.id}" aria-label="削除">${ICON.x}</button>
    </li>`).join('') : '';
  if (!meals.length) $('mealTotal').textContent = '未記録';

  // ヘルスケア
  const h = rec.health || {};
  const st = (k, v, u, dim) => `<div class="stat${dim ? ' dim' : ''}"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`;
  const has = (v) => v != null && v !== '';
  $('healthStats').innerHTML =
    st('アクティブ', has(h.activeKcal) ? fmt(h.activeKcal) : '—', 'kcal', !has(h.activeKcal)) +
    st('歩数', has(h.steps) ? fmt(h.steps) : '—', '歩', !has(h.steps)) +
    st('歩行+ラン', has(h.walkRunKm) ? (+h.walkRunKm).toFixed(1) : '—', 'km', !has(h.walkRunKm)) +
    (has(h.cycleKm) && +h.cycleKm > 0 ? st('バイク', (+h.cycleKm).toFixed(1), 'km') : '') +
    (has(h.swimM) && +h.swimM > 0 ? st('スイム', fmt(h.swimM), 'm') : '') +
    (Array.isArray(h.workouts) ? h.workouts.map((w) => st(esc(w.type || 'ワークアウト'), w.km ? (+w.km).toFixed(1) : fmt(w.min || 0), w.km ? 'km' : '分')).join('') : '');
  $('syncMeta').textContent = h.syncedAt ? `${new Date(h.syncedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 同期` : '未同期';
  $('manualList').innerHTML = (rec.manual || []).map((a) => `
    <li><div class="thumb">${ICON.act}</div>
      <div class="grow"><div class="title">${esc(a.label)}</div><div class="sub">${a.min ? a.min + '分・' : ''}手入力</div></div>
      <div class="kcal">${fmt(a.kcal)}<small>kcal</small></div>
      <button class="del" data-del-act="${a.id}" aria-label="削除">${ICON.x}</button></li>`).join('');
}

// ======================== 体重 ========================
function stepWeight(delta) {
  const i = $('weightInput');
  const v = parseFloat(i.value) || latestWeight(S.date) || 70;
  i.value = (Math.round((v + delta) * 10) / 10).toFixed(1);
}
async function saveWeight() {
  const v = parseFloat($('weightInput').value);
  if (!(v > 20 && v < 300)) return toast('体重を入力してください');
  day(S.date).weight = Math.round(v * 10) / 10;
  renderHome(); toast(`${v.toFixed(1)}kg を記録しました`);
  await saveDay(S.date);
}

// ======================== 食事 ========================
function openSheet(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
function closeSheet(id) { $(id).hidden = true; if ([...document.querySelectorAll('.sheet-wrap')].every((s) => s.hidden)) document.body.style.overflow = ''; }
function nowHM() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function mealLabel() { const h = new Date().getHours(); return h < 10 ? '朝食' : h < 15 ? '昼食' : h < 18 ? '間食' : '夕食'; }

function openMealSheet() {
  S.draft = { image: null, mediaType: null };
  $('foodPreview').hidden = true; $('photoDropText').hidden = false; $('foodPhoto').value = '';
  $('foodNote').value = ''; $('aiResult').hidden = true; $('aiToMenu').checked = false;
  $('mName').value = ''; $('mKcal').value = ''; $('mToMenu').checked = false; $('menuSearch').value = '';
  setPane(S.menu.length ? 'menu' : 'ai');
  renderMenuList();
  openSheet('mealSheet');
}
function setPane(name) {
  document.querySelectorAll('#mealSeg button').forEach((b) => b.classList.toggle('on', b.dataset.pane === name));
  document.querySelectorAll('#mealSheet .pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === name));
}

async function compressImage(file, max = 1280, q = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url; });
    const r = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  } finally { URL.revokeObjectURL(url); }
}
async function onFoodPhoto(e) {
  const f = e.target.files[0]; if (!f) return;
  const dataUrl = await compressImage(f);
  S.draft.image = dataUrl.split(',')[1]; S.draft.mediaType = 'image/jpeg';
  $('foodPreview').src = dataUrl; $('foodPreview').hidden = false; $('photoDropText').hidden = true;
}
async function analyze() {
  const note = $('foodNote').value.trim();
  if (!S.draft.image && !note) return toast('写真かメモを入れてください');
  loading(true, 'AIが推定中…');
  try {
    const history = [...S.menu].sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 30).map((m) => ({ name: m.name, kcal: m.kcal }));
    const r = await api('analyze', { method: 'POST', body: JSON.stringify({ imageBase64: S.draft.image, mediaType: S.draft.mediaType, note, history }) });
    renderAiItems(r.items || []);
    const conf = { high: ['確度 高', 'good'], medium: ['確度 中', 'accent'], low: ['確度 低', 'warn'] }[r.confidence] || ['推定', ''];
    $('aiConf').textContent = conf[0]; $('aiConf').className = 'pill ' + conf[1];
    $('aiComment').textContent = r.comment || '';
    $('aiMealName').value = r.items?.length === 1 ? r.items[0].name : (r.items || []).slice(0, 2).map((i) => i.name).join('・') || mealLabel();
    $('aiResult').hidden = false;
    setTimeout(() => $('aiResult').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  } catch (e) { toast('推定に失敗：' + e.message); }
  finally { loading(false); }
}
function renderAiItems(items) {
  $('aiItems').innerHTML = `<div class="item-cap"><span>品目</span><span>g</span><span>kcal</span><span></span></div>` +
    items.map((i) => itemRowHTML(i)).join('');
  updateAiTotal();
}
function itemRowHTML(i = { name: '', grams: '', kcal: '' }) {
  const per = i.grams ? i.kcal / i.grams : '';
  return `<div class="item-row" data-per="${per}">
    <input class="nm" type="text" value="${esc(i.name)}" placeholder="品目" />
    <input class="gram" type="number" inputmode="numeric" value="${i.grams || ''}" placeholder="g" />
    <input class="kc" type="number" inputmode="numeric" value="${i.kcal || ''}" placeholder="kcal" />
    <button class="del" aria-label="削除">${ICON.x}</button></div>`;
}
function readAiItems() {
  return [...document.querySelectorAll('#aiItems .item-row')].map((r) => ({
    name: r.querySelector('.nm').value.trim() || '品目', grams: +r.querySelector('.gram').value || 0, kcal: +r.querySelector('.kc').value || 0,
  })).filter((i) => i.kcal > 0 || i.name !== '品目');
}
function updateAiTotal() { $('aiTotal').textContent = fmt(readAiItems().reduce((s, i) => s + i.kcal, 0)); }

function addMeal(meal, toMenu) {
  const rec = day(S.date);
  rec.meals = rec.meals || [];
  rec.meals.push({ id: uid(), at: S.date === ymd(new Date()) ? nowHM() : '', ...meal });
  if (toMenu) upsertMenu({ name: meal.name, kcal: meal.kcal, items: meal.items || [] });
  closeSheet('mealSheet'); closeSheet('portionSheet');
  renderHome(); toast(`${meal.name} ${fmt(meal.kcal)}kcal を記録`);
  saveDay(S.date);
}
function upsertMenu({ name, kcal, items }) {
  const ex = S.menu.find((m) => m.name === name);
  if (ex) { ex.kcal = kcal; ex.items = items; ex.updatedAt = Date.now(); }
  else S.menu.push({ id: uid(), name, kcal, items, uses: 0, updatedAt: Date.now() });
  saveMenu();
}

function renderMenuList() {
  const q = $('menuSearch').value.trim();
  const list = S.menu.filter((m) => !q || m.name.includes(q)).sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  $('menuList').innerHTML = list.length ? list.map((m) => `
    <li data-menu="${m.id}"><div class="thumb">${ICON.star}</div>
      <div class="grow"><div class="title">${esc(m.name)}</div><div class="sub">${m.uses ? `${m.uses}回` : '未使用'}</div></div>
      <div class="kcal">${fmt(m.kcal)}<small>kcal</small></div></li>`).join('')
    : `<li class="empty">${q ? '見つかりません' : 'AI推定や手入力で「マイメニューにも登録」すると、ここからワンタップで記録できます。'}</li>`;
}
function openPortion(id) {
  const m = S.menu.find((x) => x.id === id); if (!m) return;
  $('portionTitle').textContent = m.name;
  const opts = [[0.5, '半分'], [1, 'いつも'], [1.5, '1.5倍'], [2, '2倍']];
  $('portionChips').innerHTML = opts.map(([r, l]) => `<button data-ratio="${r}" class="${r === 1 ? 'main' : ''}">${fmt(m.kcal * r)}<small>${l}</small></button>`).join('');
  $('portionChips').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const r = +b.dataset.ratio; m.uses = (m.uses || 0) + 1; m.updatedAt = Date.now(); saveMenu();
    addMeal({ name: r === 1 ? m.name : `${m.name}（×${r}）`, kcal: Math.round(m.kcal * r), items: m.items, source: 'menu' });
  };
  $('menuDelete').onclick = () => {
    if (!confirm(`「${m.name}」をマイメニューから削除しますか？`)) return;
    S.menu = S.menu.filter((x) => x.id !== id); saveMenu(); renderMenuList(); closeSheet('portionSheet');
  };
  openSheet('portionSheet');
}

// ======================== 運動（手入力） ========================
function openManual() {
  $('actType').innerHTML = ACTIVITIES.map((a) => `<option value="${a.id}">${a.label}</option>`).join('');
  $('actMin').value = ''; $('actKcal').value = '';
  openSheet('manualSheet');
}
function saveManual() {
  const a = ACTIVITIES.find((x) => x.id === $('actType').value);
  const min = +$('actMin').value || 0;
  const w = latestWeight(S.date) || 70;
  const kcal = +$('actKcal').value || Math.round(a.met * w * (min / 60) - bmr(w) / 1440 * min); // 安静時分を引いた正味
  if (!(kcal > 0)) return toast('時間かkcalを入力してください');
  const rec = day(S.date); rec.manual = rec.manual || [];
  rec.manual.push({ id: uid(), type: a.id, label: a.label, min, kcal });
  closeSheet('manualSheet'); renderHome(); saveDay(S.date);
}

// ======================== 推移 ========================
function chartColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { ink: v('--ink'), ink2: v('--ink2'), ink3: v('--ink3'), line: v('--line'), good: v('--good'), warn: v('--warn'), accent: v('--accent') };
}
function renderTrend() {
  if (!window.Chart) return setTimeout(renderTrend, 200);
  const c = chartColors();
  const end = ymd(new Date());
  const start = addDays(end, -S.range + 1);
  const dates = Array.from({ length: S.range }, (_, i) => addDays(start, i));
  const cal = calibration(end);
  const K = P().kcalPerKg;

  const actual = dates.map((d) => S.days[d]?.weight ?? null);
  const trend = dates.map((d) => {
    const ws = []; for (let i = 0; i < 7; i++) { const w = S.days[addDays(d, -i)]?.weight; if (w) ws.push(w); }
    return ws.length ? +(ws.reduce((a, b) => a + b, 0) / ws.length).toFixed(2) : null;
  });
  // 理論値: 範囲内の最初の実測から出発し、記録日の収支を積み上げる
  const firstIdx = actual.findIndex((v) => v != null);
  const theory = [], corr = [];
  if (firstIdx >= 0) {
    let t = actual[firstIdx], tc = actual[firstIdx];
    dates.forEach((d, i) => {
      if (i < firstIdx) { theory.push(null); corr.push(null); return; }
      if (i > firstIdx) {
        const s = stats(addDays(d, -1)); // 前日の収支が今朝の体重に効く
        if (s.balance != null) { t += s.balance / K; tc += (s.balance + (cal.ready ? cal.offset : 0)) / K; }
      }
      theory.push(+t.toFixed(2)); corr.push(cal.ready ? +tc.toFixed(2) : null);
    });
  }
  const labels = dates.map((d) => { const x = parseYmd(d); return `${x.getMonth() + 1}/${x.getDate()}`; });
  const common = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: c.ink, titleColor: '#fff', bodyColor: '#fff', padding: 10, cornerRadius: 10, displayColors: false } },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.ink3, maxTicksLimit: 6, font: { size: 11 } }, border: { display: false } },
      y: { grid: { color: c.line }, ticks: { color: c.ink3, font: { size: 11 } }, border: { display: false } },
    },
  };
  S.charts.w?.destroy();
  S.charts.w = new Chart($('weightChart'), {
    type: 'line',
    data: {
      labels, datasets: [
        { label: '実測', data: actual, showLine: false, pointRadius: 3, pointBackgroundColor: c.ink3, pointBorderWidth: 0 },
        { label: '7日平均', data: trend, borderColor: c.ink, borderWidth: 2.2, pointRadius: 0, tension: .35, spanGaps: true },
        { label: '理論値', data: theory, borderColor: c.accent, borderWidth: 1.8, borderDash: [5, 4], pointRadius: 0, tension: .2, spanGaps: true },
        { label: '補正後', data: corr, borderColor: c.good, borderWidth: 2, pointRadius: 0, tension: .2, spanGaps: true },
      ],
    },
    options: { ...common, plugins: { ...common.plugins, tooltip: { ...common.plugins.tooltip, callbacks: { label: (x) => x.raw == null ? null : `${x.dataset.label} ${(+x.raw).toFixed(1)}kg` } } } },
  });

  const bal = dates.map((d) => stats(d).balance);
  S.charts.b?.destroy();
  S.charts.b = new Chart($('balanceChart'), {
    type: 'bar',
    data: { labels, datasets: [{ data: bal, backgroundColor: bal.map((v) => (v > 0 ? c.warn : c.good)), borderRadius: 4, maxBarThickness: 14 }] },
    options: { ...common, plugins: { ...common.plugins, tooltip: { ...common.plugins.tooltip, callbacks: { label: (x) => x.raw == null ? '未記録' : `${sign(x.raw)} kcal` } } } },
  });

  // 補正カード
  const body = $('calibBody');
  if (!cal.ready) {
    body.innerHTML = `<div>直近28日で <b>食事記録10日以上</b> と <b>体重4回以上（10日以上の間隔）</b> がそろうと、理論値と実測のズレから補正値を自動で計算します。</div>
      <div class="grid"><div class="stat"><div class="k">食事を記録した日</div><div class="v">${cal.logged}<small>/10日</small></div></div>
      <div class="stat"><div class="k">体重の記録</div><div class="v">${cal.weighIns}<small>/4回</small></div></div></div>`;
  } else {
    const o = cal.offset;
    const msg = o > 0
      ? `記録上の収支より、実際は1日あたり約${fmt(o)}kcal 多く「残って」います。食事の見積りが少なめか、消費が多めに出ている可能性があります。`
      : o < 0 ? `記録上の収支より、実際は1日あたり約${fmt(-o)}kcal 多く「減って」います。消費が少なめに出ているか、食事を多めに見積もっている可能性があります。`
        : '記録と実測がほぼ一致しています。';
    body.innerHTML = `<div class="num">${sign(o)}<small>kcal/日</small></div><div>${msg}</div>
      <div class="grid"><div class="stat"><div class="k">理論の減り（週）</div><div class="v">${sign(cal.theoryWeek, 2)}<small>kg</small></div></div>
      <div class="stat"><div class="k">実測の減り（週）</div><div class="v">${sign(cal.actualWeek, 2)}<small>kg</small></div></div></div>
      <div class="muted">直近28日（食事${cal.logged}日・体重${cal.weighIns}回）から計算。毎日更新されます。</div>`;
  }
}

// ======================== 週次 ========================
function renderWeeks() {
  const today = ymd(new Date());
  const t = parseYmd(today);
  let monday = addDays(today, -((t.getDay() + 6) % 7));
  const all = Object.keys(S.days).sort();
  const earliest = all[0] || today;
  const K = P().kcalPerKg;
  const out = [];
  for (let w = 0; w < 26 && addDays(monday, 6) >= earliest; w++, monday = addDays(monday, -7)) {
    const ds = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const ss = ds.map((d) => stats(d));
    const logged = ss.filter((s) => s.balance != null);
    const sumBal = logged.reduce((a, s) => a + s.balance, 0);
    const avgIn = logged.length ? logged.reduce((a, s) => a + s.intake, 0) / logged.length : null;
    const avgBurn = logged.length ? logged.reduce((a, s) => a + s.burn, 0) / logged.length : null;
    const ws = ds.map((d) => S.days[d]?.weight).filter(Boolean);
    const wAvg = ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null;
    out.push({ ds, ss, logged: logged.length, sumBal, avgIn, avgBurn, wAvg, theoryKg: sumBal / K });
  }
  out.forEach((wk, i) => { const prev = out[i + 1]; wk.realKg = wk.wAvg != null && prev?.wAvg != null ? wk.wAvg - prev.wAvg : null; });

  $('weekList').innerHTML = out.map((wk) => {
    const a = wk.ds[0], b = wk.ds[6];
    const cls = (v) => (v == null ? '' : v <= 0 ? 'good' : 'warn');
    return `<article class="card week">
      <div class="week-head"><h3>${jpDate(a, false)} 〜 ${jpDate(b, false)}</h3><span class="muted">記録 ${wk.logged}/7日</span></div>
      <div class="week-grid">
        <div><div class="k">平均摂取</div><div class="v">${wk.avgIn == null ? '—' : fmt(wk.avgIn)}</div></div>
        <div><div class="k">平均消費</div><div class="v">${wk.avgBurn == null ? '—' : fmt(wk.avgBurn)}</div></div>
        <div><div class="k">理論</div><div class="v ${cls(wk.theoryKg)}">${wk.logged ? sign(wk.theoryKg, 2) : '—'}</div></div>
        <div><div class="k">実測（平均差）</div><div class="v ${cls(wk.realKg)}">${wk.realKg == null ? '—' : sign(wk.realKg, 2)}</div></div>
      </div>
      <div class="week-days">${wk.ds.map((d, i) => {
        const s = wk.ss[i]; const w = S.days[d]?.weight;
        const c = s.balance == null ? 'none' : s.balance <= 0 ? 'good' : 'warn';
        return `<button class="wd ${c}" data-goto="${d}">${WD[parseYmd(d).getDay()]}<b>${s.balance == null ? '·' : sign(s.balance / 1000, 1) + 'k'}</b>${w ? w.toFixed(1) : ''}</button>`;
      }).join('')}</div>
    </article>`;
  }).join('') || '<p class="hint">まだ記録がありません。</p>';
}

// ======================== 設定 ========================
function renderSettings() {
  const p = P();
  $('pName').value = p.name || ''; $('pAge').value = p.age || ''; $('pGender').value = p.gender || 'male';
  $('pHeight').value = p.height || ''; $('pGoal').value = p.goal || ''; $('pKcalKg').value = p.kcalPerKg || 7000;
  $('pAutoCorr').checked = p.autoCorr !== false;
  $('sKey').value = S.key;
  const old = Object.keys(localStorage).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
  $('dataHint').textContent = `クラウドの記録：${Object.keys(S.days).length}日分・マイメニュー${S.menu.length}件` + (old.length ? `／この端末に旧データ${old.length}日分あり` : '');
  $('migrateBtn').hidden = !old.length;
}
async function saveProfile() {
  S.profile = {
    ...S.profile,
    name: $('pName').value.trim(), age: +$('pAge').value || null, gender: $('pGender').value,
    height: +$('pHeight').value || null, goal: +$('pGoal').value || null,
    kcalPerKg: +$('pKcalKg').value || 7000, autoCorr: $('pAutoCorr').checked,
  };
  applyAvatar(); await saveProfileRemote(); toast('保存しました'); renderHome();
}
function applyAvatar() {
  const photo = localStorage.getItem(LS.photo);
  const initial = (S.profile.name || 'Y').trim().charAt(0).toUpperCase();
  [['avatarImg', 'avatarInitial'], ['avatarImg2', 'avatarInitial2']].forEach(([img, ini]) => {
    $(ini).textContent = initial;
    if (photo) { $(img).src = photo; $(img).hidden = false; $(ini).hidden = true; } else { $(img).hidden = true; $(ini).hidden = false; }
  });
}
async function onProfilePhoto(e) {
  const f = e.target.files[0]; if (!f) return;
  localStorage.setItem(LS.photo, await compressImage(f, 240, 0.8)); applyAvatar();
}
async function migrateOld() {
  const old = Object.keys(localStorage).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  if (!old.length) return;
  if (!confirm(`旧MoveLogの${old.length}日分をクラウドへ移します。同じ日に新しい記録がある場合はそちらを優先します。`)) return;
  loading(true, '移行中…');
  let n = 0;
  for (const k of old) {
    try {
      const o = JSON.parse(localStorage.getItem(k)); const rec = day(k);
      if (o.weight && !rec.weight) rec.weight = +o.weight;
      if (o.intake && !(rec.meals || []).length) rec.meals = [{ id: uid(), at: '', name: '旧MoveLogの記録', kcal: +o.intake, source: 'legacy' }];
      if (o.totalExerciseCal && !(rec.manual || []).length) rec.manual = [{ id: uid(), type: 'other', label: '旧MoveLogの運動', min: 0, kcal: +o.totalExerciseCal }];
      await api(`day/${k}`, { method: 'PUT', body: JSON.stringify(rec) }); n++;
    } catch {}
  }
  try {
    const op = JSON.parse(localStorage.getItem('profile') || '{}');
    S.profile = { name: op.name, age: +op.age || undefined, gender: op.gender, height: +op.height || undefined, ...S.profile };
    await saveProfileRemote();
  } catch {}
  persistCache(); loading(false); toast(`${n}日分を移しました`); renderSettings(); renderHome();
}
function exportCSV() {
  const rows = [['日付', '体重', '摂取kcal', '基礎代謝', 'アクティブ/日常', '手入力運動', '消費kcal', '差kcal', '理論kg', '歩数', '歩行+ランkm', '食事']];
  Object.keys(S.days).sort().forEach((d) => {
    const s = stats(d), r = s.rec, h = r.health || {};
    rows.push([d, r.weight || '', s.intake ?? '', s.base, s.daily, s.manual, s.burn, s.balance ?? '', s.kg == null ? '' : s.kg.toFixed(2), h.steps ?? '', h.walkRunKm ?? '', (r.meals || []).map((m) => `${m.name}:${m.kcal}`).join(' / ')]);
  });
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `movelog_${ymd(new Date())}.csv`; a.click();
}
async function connect(key, errEl) {
  S.key = key;
  try {
    await api('ping');
    localStorage.setItem(LS.key, key);
    loading(true, '同期中…'); await pullAll(); loading(false);
    applyAvatar(); renderHome();
    return true;
  } catch (e) { loading(false); if (errEl) errEl.textContent = e.message; else toast(e.message); return false; }
}

// ======================== イベント ========================
function bind() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('prevDay').onclick = () => setDate(addDays(S.date, -1));
  $('nextDay').onclick = () => setDate(addDays(S.date, 1));
  $('dateLabel').onclick = () => { const p = $('datePicker'); p.value = S.date; p.max = ymd(new Date()); p.showPicker ? p.showPicker() : p.click(); };
  $('datePicker').onchange = (e) => e.target.value && setDate(e.target.value);
  $('avatarBtn').onclick = () => showTab('settings');

  document.querySelectorAll('.step').forEach((b) => (b.onclick = () => stepWeight(+b.dataset.step)));
  $('saveWeight').onclick = saveWeight;
  $('weightInput').addEventListener('keydown', (e) => e.key === 'Enter' && saveWeight());

  $('addMealBtn').onclick = openMealSheet;
  $('mealSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) setPane(b.dataset.pane); };
  $('foodPhoto').onchange = onFoodPhoto;
  $('analyzeBtn').onclick = analyze;
  $('aiItems').addEventListener('input', (e) => {
    const row = e.target.closest('.item-row'); if (!row) return;
    if (e.target.classList.contains('gram') && row.dataset.per) row.querySelector('.kc').value = Math.round(+e.target.value * +row.dataset.per) || '';
    if (e.target.classList.contains('kc')) { const g = +row.querySelector('.gram').value; row.dataset.per = g ? +e.target.value / g : ''; }
    updateAiTotal();
  });
  $('aiItems').addEventListener('click', (e) => { if (e.target.closest('.del')) { e.target.closest('.item-row').remove(); updateAiTotal(); } });
  $('addItemRow').onclick = () => { $('aiItems').insertAdjacentHTML('beforeend', itemRowHTML()); };
  $('aiSave').onclick = () => {
    const items = readAiItems(); const kcal = items.reduce((s, i) => s + i.kcal, 0);
    if (!kcal) return toast('kcalを入力してください');
    addMeal({ name: $('aiMealName').value.trim() || mealLabel(), kcal, items, source: 'ai', note: $('foodNote').value.trim() }, $('aiToMenu').checked);
  };
  $('menuSearch').oninput = renderMenuList;
  $('menuList').onclick = (e) => { const li = e.target.closest('[data-menu]'); if (li) openPortion(li.dataset.menu); };
  $('mSave').onclick = () => {
    const kcal = +$('mKcal').value; if (!kcal) return toast('kcalを入力してください');
    addMeal({ name: $('mName').value.trim() || mealLabel(), kcal, source: 'manual' }, $('mToMenu').checked);
  };
  $('mealList').onclick = (e) => {
    const b = e.target.closest('[data-del-meal]'); if (!b) return;
    const rec = day(S.date); rec.meals = (rec.meals || []).filter((m) => m.id !== b.dataset.delMeal); renderHome(); saveDay(S.date);
  };
  $('manualList').onclick = (e) => {
    const b = e.target.closest('[data-del-act]'); if (!b) return;
    const rec = day(S.date); rec.manual = (rec.manual || []).filter((a) => a.id !== b.dataset.delAct); renderHome(); saveDay(S.date);
  };
  $('addManualBtn').onclick = openManual;
  $('actSave').onclick = saveManual;
  $('syncBtn').onclick = () => { location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`; };

  document.querySelectorAll('.sheet-wrap').forEach((w) => w.addEventListener('click', (e) => {
    if (w.id === 'setupSheet') return;
    if (e.target === w || e.target.closest('[data-close]')) closeSheet(w.id);
  }));

  $('rangeSeg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.range = +b.dataset.range; document.querySelectorAll('#rangeSeg button').forEach((x) => x.classList.toggle('on', x === b)); renderTrend();
  };
  $('weekList').onclick = (e) => { const b = e.target.closest('[data-goto]'); if (b) { S.date = b.dataset.goto; showTab('home'); renderHome(); } };

  $('saveProfile').onclick = saveProfile;
  $('photoBtn').onclick = () => $('photoInput').click();
  $('photoInput').onchange = onProfilePhoto;
  $('saveKey').onclick = async () => { if (await connect($('sKey').value.trim())) { $('connStatus').textContent = '接続OK'; toast('接続できました'); } };
  $('migrateBtn').onclick = migrateOld;
  $('csvBtn').onclick = exportCSV;
  $('setupSave').onclick = async () => { $('setupErr').textContent = ''; if (await connect($('setupKey').value.trim(), $('setupErr'))) closeSheet('setupSheet'); };

  // アプリに戻ってきたら最新を取得（ショートカット同期の後など）
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && S.key) { try { await pullAll(); renderHome(); } catch {} }
  });
}

// ======================== 起動 ========================
(async function init() {
  bind(); applyAvatar(); renderHome();
  if (!S.key) { openSheet('setupSheet'); return; }
  try { await pullAll(); applyAvatar(); renderHome(); }
  catch (e) { toast(e.message.includes('合言葉') ? '合言葉を確認してください' : 'オフライン表示中'); }
})();
