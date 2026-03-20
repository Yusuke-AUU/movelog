// ===== 定数・ユーティリティ =====
const BUILT_IN_ACTIVITIES = [
  { value: 'off',        label: '🚫 OFF',        hasDistance: false, metPerHour: 0 },
  { value: 'swim',       label: '🏊‍♂️ スイム',    hasDistance: true,  metPerHour: 8.5 },
  { value: 'bike',       label: '🚴‍♂️ バイク',    hasDistance: true,  metPerHour: 7.5 },
  { value: 'run',        label: '🏃‍♂️ ラン',      hasDistance: true,  metPerHour: 9.8 },
  { value: 'trampoline', label: '🪽 トランポリン', hasDistance: false, metPerHour: 4.5 },
  { value: 'ballet',     label: '🩰 バレエ',      hasDistance: false, metPerHour: 4.8 },
  { value: 'workout',    label: '💪 筋トレ',      hasDistance: false, metPerHour: 5.0 },
];

// 理論体重変化の係数: 7700kcal = 体脂肪1kg（標準値に修正）
const KCAL_PER_KG = 7700;

function getProfile() { return JSON.parse(localStorage.getItem('profile') || '{}'); }
function getGoal() { return JSON.parse(localStorage.getItem('goal') || '{}'); }
function getAllActivities() {
  const custom = JSON.parse(localStorage.getItem('customActivities') || '[]');
  return [...BUILT_IN_ACTIVITIES, ...custom];
}
function formatDate(d) { return d.toISOString().split('T')[0]; }
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// ===== BMR（Mifflin-St Jeor × 1.2固定） =====
function calcBMR(weight) {
  const p = getProfile();
  const w = weight || parseFloat(document.getElementById('weight')?.value) || 70;
  const age = parseFloat(p.age) || 30;
  const height = parseFloat(p.height) || 170;
  const gender = p.gender || 'male';
  let bmr = gender === 'male'
    ? 10 * w + 6.25 * height - 5 * age + 5
    : 10 * w + 6.25 * height - 5 * age - 161;
  return Math.round(bmr * 1.2);
}

// ===== 運動カロリー計算（MET × 体重 × 時間） =====
function calcActivityCalories(type, minutes, distance, weight) {
  const w = weight || parseFloat(document.getElementById('weight')?.value) || 70;
  const act = getAllActivities().find(a => a.value === type);
  if (!act || act.metPerHour === 0) return 0;
  return Math.round(act.metPerHour * w * (minutes / 60));
}

// ===== 記録タブ =====
const today = formatDate(new Date());
const dateInput = document.getElementById('date');
if (dateInput) dateInput.value = today;

// 【修正6】日付変更時に過去データを自動ロード
if (dateInput) {
  dateInput.addEventListener('change', function () { loadRecordForDate(this.value); });
}

function loadRecordForDate(dateStr) {
  const record = JSON.parse(localStorage.getItem(dateStr));
  document.getElementById('trainingContainer').innerHTML = '';
  document.getElementById('summaryCard').style.display = 'none';
  document.getElementById('goalBarCard').style.display = 'none';
  document.getElementById('aiResult').style.display = 'none';
  document.getElementById('photoPreview').style.display = 'none';

  if (record) {
    document.getElementById('weight').value = record.weight;
    document.getElementById('intake').value = record.intake;
    (record.trainings || []).forEach(t => addTrainingRow(t)); // 【修正3】値も復元
    renderSummary(record);
    updateGoalBar(record);
  } else {
    document.getElementById('weight').value = '';
    document.getElementById('intake').value = '';
  }
}

document.getElementById('addTraining').addEventListener('click', () => addTrainingRow());

function addTrainingRow(preset) {
  const container = document.getElementById('trainingContainer');
  const div = document.createElement('div');
  div.className = 'training-row';
  const options = getAllActivities().map(a =>
    `<option value="${a.value}"${preset && preset.type === a.value ? ' selected' : ''}>${a.label}</option>`
  ).join('');
  div.innerHTML = `
    <select class="activity">${options}</select>
    <div class="training-inputs">
      <input type="number" class="minutes" placeholder="分数" min="0" value="${preset?.minutes || ''}">
      <input type="number" class="distance" placeholder="距離(km)" step="0.1" min="0" value="${preset?.distance || ''}">
      <button type="button" class="delete-training" onclick="this.closest('.training-row').remove()">🗑</button>
    </div>
  `;
  container.appendChild(div);
  const sel = div.querySelector('.activity');
  const distInput = div.querySelector('.distance');
  const updateDistance = () => {
    const act = getAllActivities().find(a => a.value === sel.value);
    distInput.style.opacity = act?.hasDistance ? '1' : '0.3';
    distInput.disabled = !act?.hasDistance;
  };
  sel.addEventListener('change', updateDistance);
  updateDistance();
}

// 食事写真プレビュー
document.getElementById('foodPhoto').addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('previewImg').src = e.target.result;
    document.getElementById('photoPreview').style.display = 'block';
  };
  reader.readAsDataURL(file);
});

// AI食事分析
async function analyzeFood() {
  const img = document.getElementById('previewImg').src;
  if (!img) return;
  openModal('aiLoading');
  const base64 = img.split(',')[1];
  const mediaType = img.match(/data:(image\/\w+)/)?.[1] || 'image/jpeg';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'この食事の写真を見て、各料理の名前と推定カロリーを日本語で答えてください。最後に合計カロリーを「合計: XXXkcal」の形式で書いてください。簡潔に箇条書きで。' }
        ]}]
      })
    });
    const data = await res.json();
    const text = data.content?.find(c => c.type === 'text')?.text || '分析できませんでした';
    closeModal('aiLoading');
    const aiResult = document.getElementById('aiResult');
    aiResult.style.display = 'block';
    aiResult.innerHTML = `<strong>🤖 AI分析結果</strong><br><br>${text.replace(/\n/g, '<br>')}`;
    const match = text.match(/合計[:：]\s*(\d+)\s*kcal/i);
    if (match) {
      document.getElementById('intake').value = match[1];
      showToast(`✅ ${match[1]}kcal を自動入力しました`);
    }
  } catch (e) {
    closeModal('aiLoading');
    showToast('❌ AI分析に失敗しました');
  }
}

// 保存
document.getElementById('saveBtn').addEventListener('click', function () {
  const date = document.getElementById('date').value;
  const weight = parseFloat(document.getElementById('weight').value);
  const intake = parseFloat(document.getElementById('intake').value);
  if (!date || isNaN(weight) || isNaN(intake)) {
    showToast('⚠️ 日付・体重・カロリーを入力してください');
    return;
  }

  let totalExerciseCal = 0;
  const trainings = [];
  document.querySelectorAll('#trainingContainer .training-row').forEach(row => {
    const type = row.querySelector('.activity').value;
    if (type === 'off') return; // 【修正5】OFFは保存しない
    const minutes = parseFloat(row.querySelector('.minutes').value || 0);
    const distance = parseFloat(row.querySelector('.distance').value || 0);
    const cal = calcActivityCalories(type, minutes, distance, weight);
    totalExerciseCal += cal;
    const act = getAllActivities().find(a => a.value === type);
    trainings.push({ type, label: act?.label || type, minutes, distance, calories: cal });
  });

  const metabolism = calcBMR(weight);
  const totalBurned = totalExerciseCal + metabolism;
  const balance = intake - totalBurned;
  const theoryLoss = Math.round((balance / KCAL_PER_KG) * 100) / 100; // 【修正4】7700kcal/kg
  const activities = trainings.map(t => t.label.split(' ')[0]).join(' ');
  const record = { date, weight, intake, totalExerciseCal, metabolism, totalBurned, balance, theoryLoss, activities, trainings };

  localStorage.setItem(date, JSON.stringify(record));
  renderSummary(record);
  updateGoalBar(record);
  showToast('✅ 記録を保存しました');
});

function renderSummary(record) {
  document.getElementById('summaryCard').style.display = 'block';
  const trainingHtml = (record.trainings || []).map(t => {
    const detail = t.distance > 0 ? `${t.minutes}分 / ${t.distance}km / ${t.calories}kcal` : `${t.minutes}分 / ${t.calories}kcal`;
    return `<div class="training-summary-item"><span>${t.label}</span><span>${detail}</span></div>`;
  }).join('');
  const bc = record.balance >= 0 ? 'val-positive' : 'val-negative';
  const lc = record.theoryLoss >= 0 ? 'val-positive' : 'val-negative';
  document.getElementById('summaryText').innerHTML = `
    <div class="summary-row"><span>⚖️ 体重</span><span class="summary-val">${record.weight} kg</span></div>
    <div class="summary-row"><span>🍙 摂取カロリー</span><span class="summary-val">${record.intake} kcal</span></div>
    <div class="summary-row"><span>🔋 基礎代謝</span><span class="summary-val">${record.metabolism} kcal</span></div>
    <div class="summary-row"><span>🔥 運動消費</span><span class="summary-val">${Math.round(record.totalExerciseCal)} kcal</span></div>
    ${trainingHtml}
    <div class="summary-row"><span>💓 合計消費</span><span class="summary-val">${Math.round(record.totalBurned)} kcal</span></div>
    <div class="summary-row"><span>⚖️ カロリー差</span><span class="summary-val ${bc}">${record.balance >= 0 ? '+' : ''}${Math.round(record.balance)} kcal</span></div>
    <div class="summary-row"><span>📉 理論体重変化</span><span class="summary-val ${lc}">${record.theoryLoss >= 0 ? '+' : ''}${record.theoryLoss} kg</span></div>
  `;
}

function updateGoalBar(record) {
  const goal = getGoal();
  if (!goal.balance) return;
  document.getElementById('goalBarCard').style.display = 'block';
  const target = parseFloat(goal.balance);
  const pct = Math.max(0, Math.min(100, (1 - Math.abs(record.balance - target) / Math.abs(target)) * 100));
  document.getElementById('goalBalanceText').textContent = `目標: ${target}kcal / 実際: ${Math.round(record.balance)}kcal`;
  document.getElementById('goalProgress').style.width = pct + '%';
}

// ===== カレンダー =====
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();

function changeMonth(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  generateCalendar();
}

function generateCalendar() {
  const container = document.getElementById('calendarContainer');
  container.innerHTML = '';
  document.getElementById('monthLabel').textContent = `${calYear}年${calMonth + 1}月`;
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr = formatDate(new Date());
  for (let i = 0; i < firstDay; i++) {
    const e = document.createElement('div'); e.className = 'calendar-day empty'; container.appendChild(e);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const record = JSON.parse(localStorage.getItem(dateStr));
    const div = document.createElement('div');
    div.className = 'calendar-day' + (record ? ' has-record' : '') + (dateStr === todayStr ? ' today' : '');
    if (record) {
      const bc = record.balance >= 0 ? 'positive' : 'negative';
      div.innerHTML = `
        <div class="cal-date">${d}</div>
        <div class="cal-weight">${record.weight}kg</div>
        <div class="cal-activities">${record.activities || ''}</div>
        <div class="cal-balance ${bc}">${record.balance >= 0 ? '+' : ''}${Math.round(record.balance)}kcal</div>
      `;
      div.addEventListener('click', () => showDayDetail(dateStr, record));
    } else {
      div.innerHTML = `<div class="cal-date">${d}</div>`;
    }
    container.appendChild(div);
  }
}

function showDayDetail(dateStr, record) {
  const trainingHtml = (record.trainings || []).map(t => {
    const detail = t.distance > 0 ? `${t.minutes}分 / ${t.distance}km / ${t.calories}kcal` : `${t.minutes}分 / ${t.calories}kcal`;
    return `<div class="training-summary-item"><span>${t.label || t.type}</span><span>${detail}</span></div>`;
  }).join('');
  const bc = record.balance >= 0 ? 'val-positive' : 'val-negative';
  document.getElementById('detailContent').innerHTML = `
    <div class="modal-title">📅 ${dateStr}</div>
    <div class="summary-row"><span>⚖️ 体重</span><span class="summary-val">${record.weight} kg</span></div>
    <div class="summary-row"><span>🍙 摂取</span><span class="summary-val">${record.intake} kcal</span></div>
    <div class="summary-row"><span>🔋 基礎代謝</span><span class="summary-val">${record.metabolism} kcal</span></div>
    <div class="summary-row"><span>🔥 運動消費</span><span class="summary-val">${Math.round(record.totalExerciseCal || record.totalCalories || 0)} kcal</span></div>
    ${trainingHtml}
    <div class="summary-row"><span>💓 合計消費</span><span class="summary-val">${Math.round(record.totalBurned)} kcal</span></div>
    <div class="summary-row"><span>⚖️ カロリー差</span><span class="summary-val ${bc}">${record.balance >= 0 ? '+' : ''}${Math.round(record.balance)} kcal</span></div>
    <div class="summary-row"><span>📉 理論変化</span><span class="summary-val ${bc}">${record.theoryLoss >= 0 ? '+' : ''}${record.theoryLoss} kg</span></div>
  `;
  openModal('detailModal');
}

// ===== グラフ =====
let chartRange = 7;
let charts = {};

function setRange(days, btn) {
  chartRange = days;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCharts();
}

function getChartData(days) {
  const allKeys = Object.keys(localStorage).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  const recent = days === 0 ? allKeys : allKeys.slice(-days);
  const labels = [], intake = [], burned = [], weight = [], balance = [];
  recent.forEach(k => {
    try {
      const r = JSON.parse(localStorage.getItem(k));
      if (r && r.weight) {
        labels.push(k.slice(5)); intake.push(r.intake || 0);
        burned.push(r.totalBurned || 0); weight.push(r.weight); balance.push(r.balance || 0);
      }
    } catch(e) {}
  });
  return { labels, intake, burned, weight, balance };
}

function renderCharts() {
  // 【修正2】canvasを確実にリセットして二重描画を防ぐ
  ['calorieChart', 'weightChart', 'balanceChart'].forEach(id => {
    if (charts[id]) { charts[id].destroy(); charts[id] = null; }
    const canvas = document.getElementById(id);
    if (canvas) { const p = canvas.parentNode; p.replaceChild(canvas.cloneNode(false), canvas); }
  });

  const { labels, intake, burned, weight, balance } = getChartData(chartRange);
  const opts = () => ({
    responsive: true,
    plugins: { legend: { labels: { color: '#8899aa', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#8899aa', font: { size: 10 }, maxRotation: 45 }, grid: { color: '#1e2d4a' } },
      y: { ticks: { color: '#8899aa' }, grid: { color: '#1e2d4a' } }
    }
  });

  charts.calorieChart = new Chart(document.getElementById('calorieChart').getContext('2d'), {
    type: 'line', data: { labels, datasets: [
      { label: '摂取', data: intake, borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.1)', tension: 0.3, pointRadius: 3 },
      { label: '消費', data: burned, borderColor: '#ff6b35', backgroundColor: 'rgba(255,107,53,0.1)', tension: 0.3, pointRadius: 3 }
    ]}, options: opts()
  });
  charts.weightChart = new Chart(document.getElementById('weightChart').getContext('2d'), {
    type: 'line', data: { labels, datasets: [
      { label: '体重(kg)', data: weight, borderColor: '#7fff00', backgroundColor: 'rgba(127,255,0,0.1)', tension: 0.3, pointRadius: 3 }
    ]}, options: opts()
  });
  charts.balanceChart = new Chart(document.getElementById('balanceChart').getContext('2d'), {
    type: 'bar', data: { labels, datasets: [{
      label: 'カロリー差(kcal)', data: balance,
      backgroundColor: balance.map(v => v >= 0 ? 'rgba(255,59,92,0.7)' : 'rgba(0,230,118,0.7)'),
    }]}, options: opts()
  });
}

// ===== サマリータブ =====
let summaryRange = 'week';

function setSummaryRange(range, btn) {
  summaryRange = range;
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSummaryStats();
}

function renderSummaryStats() {
  const now = new Date();
  let startDate = new Date(now);
  if (summaryRange === 'week') {
    // 【修正7】月曜始まりに修正
    const day = now.getDay();
    startDate.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const startStr = formatDate(startDate);
  const keys = Object.keys(localStorage).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && k >= startStr).sort();

  let totalIntake = 0, totalBurned = 0, totalBalance = 0, weightList = [], trainingCount = 0;
  keys.forEach(k => {
    try {
      const r = JSON.parse(localStorage.getItem(k));
      if (!r) return;
      totalIntake += r.intake || 0; totalBurned += r.totalBurned || 0; totalBalance += r.balance || 0;
      if (r.weight) weightList.push(r.weight);
      trainingCount += (r.trainings || []).filter(t => t.type !== 'off' && t.calories > 0).length;
    } catch(e) {}
  });

  const days = keys.length;
  const avgIntake = days ? Math.round(totalIntake / days) : 0;
  const avgBurned = days ? Math.round(totalBurned / days) : 0;
  const weightChange = weightList.length >= 2 ? (weightList[weightList.length-1] - weightList[0]).toFixed(1) : '—';
  const bc = totalBalance >= 0 ? 'val-positive' : 'val-negative';
  const theoryKg = (totalBalance / KCAL_PER_KG).toFixed(2); // 【修正4】7700統一

  document.getElementById('summaryStats').innerHTML = `
    <div class="stat-card">
      <div class="stat-title">RECORDED DAYS</div>
      <div class="stat-big">${days}<span style="font-size:20px;color:#8899aa"> 日</span></div>
    </div>
    <div class="stat-grid" style="margin-bottom:10px;">
      <div class="stat-card stat-item"><div class="stat-label">平均摂取</div><div class="stat-value" style="color:#00d4ff">${avgIntake}<small style="font-size:12px">kcal</small></div></div>
      <div class="stat-card stat-item"><div class="stat-label">平均消費</div><div class="stat-value" style="color:#ff6b35">${avgBurned}<small style="font-size:12px">kcal</small></div></div>
      <div class="stat-card stat-item"><div class="stat-label">体重変化</div><div class="stat-value" style="color:#7fff00">${weightChange !== '—' ? (weightChange >= 0 ? '+' : '') + weightChange : '—'}<small style="font-size:12px">${weightChange !== '—' ? 'kg' : ''}</small></div></div>
      <div class="stat-card stat-item"><div class="stat-label">トレーニング</div><div class="stat-value" style="color:#fff">${trainingCount}<small style="font-size:12px">回</small></div></div>
    </div>
    <div class="stat-card">
      <div class="stat-title">TOTAL CALORIE BALANCE</div>
      <div class="stat-big ${bc}">${totalBalance >= 0 ? '+' : ''}${Math.round(totalBalance)}<span style="font-size:18px;color:#8899aa">kcal</span></div>
      <div style="font-size:12px;color:#8899aa;margin-top:4px;">理論体重変化: ${theoryKg >= 0 ? '+' : ''}${theoryKg} kg</div>
    </div>
  `;
}

// ===== プロフィール =====
function loadProfileForm() {
  const p = getProfile(); const g = getGoal();
  if (p.name) document.getElementById('profileName').value = p.name;
  if (p.age) document.getElementById('profileAge').value = p.age;
  if (p.gender) document.getElementById('profileGender').value = p.gender;
  if (p.height) document.getElementById('profileHeight').value = p.height;
  // 【修正1】profileActivity参照を削除（UI上に存在しないため）
  if (g.weight) document.getElementById('goalWeight').value = g.weight;
  if (g.balance) document.getElementById('goalBalance').value = g.balance;
  renderCustomActivitiesForm();
}

function saveProfile() {
  const profile = {
    name: document.getElementById('profileName').value,
    age: document.getElementById('profileAge').value,
    gender: document.getElementById('profileGender').value,
    height: document.getElementById('profileHeight').value,
    // 【修正1】activityLevelは固定のため保存不要
  };
  const goal = {
    weight: document.getElementById('goalWeight').value,
    balance: document.getElementById('goalBalance').value,
  };
  const customRows = document.querySelectorAll('#customActivitiesContainer .custom-activity-row');
  const customActivities = [];
  customRows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const label = inputs[0].value.trim();
    const emoji = inputs[1].value.trim() || '🏋️';
    const met = parseFloat(inputs[2].value) || 5;
    if (label) customActivities.push({ value: 'custom_' + label, label: `${emoji} ${label}`, hasDistance: false, metPerHour: met });
  });
  localStorage.setItem('profile', JSON.stringify(profile));
  localStorage.setItem('goal', JSON.stringify(goal));
  localStorage.setItem('customActivities', JSON.stringify(customActivities));
  closeModal('profileModal');
  showToast('✅ プロフィールを保存しました');
}

function renderCustomActivitiesForm() {
  const customs = JSON.parse(localStorage.getItem('customActivities') || '[]');
  const container = document.getElementById('customActivitiesContainer');
  container.innerHTML = '';
  customs.forEach(a => addCustomActivityRow(a));
}
function addCustomActivity() { addCustomActivityRow(); }
function addCustomActivityRow(preset) {
  const container = document.getElementById('customActivitiesContainer');
  const div = document.createElement('div');
  div.className = 'custom-activity-row';
  div.innerHTML = `
    <input type="text" placeholder="種目名" value="${preset ? preset.label.split(' ').slice(1).join(' ') : ''}">
    <input type="text" placeholder="絵文字" maxlength="2" value="${preset ? preset.label.split(' ')[0] : ''}">
    <input type="number" placeholder="MET" step="0.1" value="${preset ? preset.metPerHour : '5'}">
    <button class="delete-training" onclick="this.closest('.custom-activity-row').remove()">🗑</button>
  `;
  container.appendChild(div);
}

// ===== CSVエクスポート =====
function exportCSV() {
  const keys = Object.keys(localStorage).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  if (!keys.length) { showToast('⚠️ エクスポートするデータがありません'); return; }
  const rows = [['日付','体重(kg)','摂取(kcal)','基礎代謝(kcal)','運動消費(kcal)','合計消費(kcal)','差分(kcal)','理論体重変化(kg)','アクティビティ']];
  keys.forEach(k => {
    try {
      const r = JSON.parse(localStorage.getItem(k));
      if (r) rows.push([r.date, r.weight, r.intake, r.metabolism, Math.round(r.totalExerciseCal || r.totalCalories || 0), Math.round(r.totalBurned), Math.round(r.balance), r.theoryLoss, r.activities || '']);
    } catch(e) {}
  });
  const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'movelog_export.csv';
  a.click(); URL.revokeObjectURL(url);
  showToast('📤 CSVをエクスポートしました');
}

// ===== タブ切り替え =====
function showTab(id) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.getElementById('nav-' + id).classList.add('active');
  if (id === 'calendar') generateCalendar();
  if (id === 'graph') renderCharts();
  if (id === 'summary') renderSummaryStats();
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('[onclick="openModal(\'profileModal\')"]')?.addEventListener('click', loadProfileForm);
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
  });
  loadRecordForDate(today); // 今日のデータを読み込み
});
