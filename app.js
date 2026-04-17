/* ============================================================
   HABIT TRACKER — app.js
   Phase 1: data safety, edit, import/export, pause, undo, range
   ============================================================ */

// ── STATE ────────────────────────────────────────────────
const KEY = 'habittracker_v3';
// habits: [{ id, name, createdAt, freq, pausedAt? }]
// freq: { type:'daily' } | { type:'weekly', days:[0..6] } | { type:'xtimes', times:N }
let habits = [];
let log = {};              // { 'YYYY-MM-DD': [habitId, ...] }
let activeTab  = 'today';
let calRange   = 90;       // 30 | 90 | 180 | 365

// Add-form state
let freqMode = 'daily';
let selectedDays = [];
let timesPerWeek = 3;

// Edit-form state
let editingId = null;
let editFreqMode = 'daily';
let editSelectedDays = [];
let editTimesPerWeek = 3;

// Undo state
let pendingUndo = null;    // { type, data, timer }

// ── HELPERS ──────────────────────────────────────────────
function todayStr() { const d = new Date(); return dateStr(d); }
function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
function pad(n) { return String(n).padStart(2,'0'); }
function dayName(d) { return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]; }
function fullDayName(d) { return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]; }
function monthName(d) { return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]; }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function isPaused(h) { return !!h.pausedAt; }
function isActive(h) { return !isPaused(h); }

function isScheduled(habit, dateObj) {
  if (isPaused(habit)) return false;
  const f = habit.freq || { type:'daily' };
  if (f.type === 'daily')   return true;
  if (f.type === 'weekly')  return (f.days || []).includes(dateObj.getDay());
  if (f.type === 'xtimes')  return true;
  return true;
}

function weekStart(dateObj) {
  const d = new Date(dateObj);
  d.setHours(0,0,0,0);
  const day = d.getDay();
  const diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function countDoneInWeekOf(habitId, dateObj) {
  const ws = weekStart(dateObj);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const dd = new Date(ws); dd.setDate(ws.getDate() + i);
    if ((log[dateStr(dd)] || []).includes(habitId)) n++;
  }
  return n;
}

function isRestToday(habit) {
  if (isPaused(habit)) return true;
  const f = habit.freq || { type:'daily' };
  const today = new Date();
  if (f.type === 'weekly' && !isScheduled(habit, today)) return true;
  if (f.type === 'xtimes') {
    const checked = (log[todayStr()] || []).includes(habit.id);
    if (checked) return false;
    return countDoneInWeekOf(habit.id, today) >= (f.times || 1);
  }
  return false;
}

function freqLabel(freq) {
  if (!freq || freq.type === 'daily') return 'Daily';
  if (freq.type === 'weekly') {
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const order = [1,2,3,4,5,6,0];
    const sorted = [...(freq.days||[])].sort((a,b) => order.indexOf(a) - order.indexOf(b));
    return sorted.map(d => names[d]).join(' · ');
  }
  if (freq.type === 'xtimes') return (freq.times || 1) + '×/week';
  return 'Daily';
}

// ── STREAKS ──────────────────────────────────────────────
function getStreak(habit) {
  if (isPaused(habit)) return 0;
  const f = habit.freq || { type:'daily' };
  if (f.type === 'xtimes') return getXTimesStreak(habit);

  let streak = 0;
  const d = new Date(); d.setHours(0,0,0,0);
  const todayScheduled = isScheduled(habit, d);
  const todayDone = (log[dateStr(d)] || []).includes(habit.id);
  if (todayScheduled && !todayDone) d.setDate(d.getDate() - 1);

  for (let i = 0; i < 730; i++) {
    if (!isScheduled(habit, d)) { d.setDate(d.getDate() - 1); continue; }
    if ((log[dateStr(d)] || []).includes(habit.id)) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

function getXTimesStreak(habit) {
  const target = (habit.freq || {}).times || 1;
  let streak = 0;
  const today = new Date(); today.setHours(0,0,0,0);
  let ws = weekStart(today);
  for (let w = 0; w < 52; w++) {
    let done = 0;
    for (let d = 0; d < 7; d++) {
      const dd = new Date(ws); dd.setDate(ws.getDate() + d);
      if ((log[dateStr(dd)] || []).includes(habit.id)) done++;
    }
    if (done >= target) streak++;
    else if (w > 0) break;
    ws.setDate(ws.getDate() - 7);
  }
  return streak;
}

function getBestStreak(habit) {
  if (isPaused(habit)) return 0;
  const f = habit.freq || { type:'daily' };
  if (f.type === 'xtimes') {
    const target = f.times || 1;
    let best = 0, cur = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    let ws = weekStart(today);
    for (let w = 0; w < 52; w++) {
      let done = 0;
      for (let d = 0; d < 7; d++) {
        const dd = new Date(ws); dd.setDate(ws.getDate() + d);
        if ((log[dateStr(dd)] || []).includes(habit.id)) done++;
      }
      if (done >= target) { cur++; if (cur > best) best = cur; } else cur = 0;
      ws.setDate(ws.getDate() - 7);
    }
    return best;
  }
  let best = 0, cur = 0;
  const d = new Date(); d.setHours(0,0,0,0);
  for (let i = 0; i < 730; i++) {
    if (!isScheduled(habit, d)) { d.setDate(d.getDate() - 1); continue; }
    if ((log[dateStr(d)] || []).includes(habit.id)) { cur++; if (cur > best) best = cur; } else cur = 0;
    d.setDate(d.getDate() - 1);
  }
  return best;
}

function getOverallBestStreak() {
  const active = habits.filter(isActive);
  if (!active.length) return 0;
  return Math.max(...active.map(h => getBestStreak(h)));
}

function getWeekCompletion() {
  const active = habits.filter(isActive);
  if (!active.length) return 0;
  let total = 0, done = 0;
  const today = new Date(); today.setHours(0,0,0,0);

  active.forEach(h => {
    const f = h.freq || { type:'daily' };
    if (f.type === 'xtimes') {
      total++;
      if (countDoneInWeekOf(h.id, today) >= (f.times || 1)) done++;
      return;
    }
    const d = new Date(today);
    for (let i = 0; i < 7; i++) {
      if (isScheduled(h, d)) {
        total++;
        if ((log[dateStr(d)] || []).includes(h.id)) done++;
      }
      d.setDate(d.getDate() - 1);
    }
  });
  return total ? Math.round((done / total) * 100) : 0;
}

function getTotalDone() {
  let n = 0;
  Object.values(log).forEach(arr => { n += arr.length; });
  return n;
}

// ── PERSIST ──────────────────────────────────────────────
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ habits, log })); } catch(e) {}
}

function load() {
  try {
    let raw = localStorage.getItem(KEY)
           || localStorage.getItem('habittracker_v2')
           || localStorage.getItem('habittracker_v1');
    if (raw) {
      const p = JSON.parse(raw);
      habits = (p.habits || []).map(h => ({
        ...h,
        freq: h.freq || { type:'daily' }
      }));
      log = p.log || {};
    }
  } catch(e) {}
}

// ── IMPORT / EXPORT ──────────────────────────────────────
function exportData() {
  closeMenu();
  const data = { version: 3, exportedAt: new Date().toISOString(), habits, log };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const d = new Date();
  a.download = 'habit-tracker-backup-' + dateStr(d) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded');
}

function importData(input) {
  closeMenu();
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.habits) || typeof parsed.log !== 'object') {
        toast('Invalid backup file'); return;
      }
      showModal(
        'Replace all data?',
        'This will overwrite your ' + habits.length + ' current habit(s) with ' + parsed.habits.length + ' from the backup. This cannot be undone.',
        'Replace',
        () => {
          habits = parsed.habits.map(h => ({ ...h, freq: h.freq || { type:'daily' } }));
          log = parsed.log || {};
          save(); render();
          toast('Backup restored');
        }
      );
    } catch(e) {
      toast('Could not read file');
    }
    input.value = ''; // allow re-importing same file
  };
  reader.onerror = () => { toast('Could not read file'); input.value = ''; };
  reader.readAsText(file);
}

// ── MENU ─────────────────────────────────────────────────
function toggleMenu() {
  document.getElementById('menu-panel').classList.toggle('open');
}

function closeMenu() {
  document.getElementById('menu-panel').classList.remove('open');
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('menu-panel');
  const btn = document.getElementById('menu-btn');
  if (!panel.classList.contains('open')) return;
  if (!panel.contains(e.target) && !btn.contains(e.target)) closeMenu();
});

// ── ADD FORM ─────────────────────────────────────────────
document.getElementById('habit-input').addEventListener('focus', () => {
  document.getElementById('freq-picker').classList.add('open');
});

document.getElementById('habit-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleAdd();
  if (e.key === 'Escape') {
    e.target.blur();
    document.getElementById('freq-picker').classList.remove('open');
  }
});

function setFreqMode(mode) {
  freqMode = mode;
  ['daily','weekly','xtimes'].forEach(m =>
    document.getElementById('fopt-' + m).classList.toggle('active', m === mode)
  );
  document.getElementById('day-picker').classList.toggle('open', mode === 'weekly');
  document.getElementById('times-picker').classList.toggle('open', mode === 'xtimes');
}

function toggleDay(day) {
  const btn = document.querySelector('.day-opt[data-day="' + day + '"]');
  if (selectedDays.includes(day)) {
    selectedDays = selectedDays.filter(d => d !== day);
    btn.classList.remove('active');
  } else {
    selectedDays.push(day);
    btn.classList.add('active');
  }
}

function changeTimesPerWeek(delta) {
  timesPerWeek = Math.max(1, Math.min(7, timesPerWeek + delta));
  document.getElementById('times-val').textContent = timesPerWeek;
}

function buildFreq(mode, days, times) {
  if (mode === 'daily')  return { type:'daily' };
  if (mode === 'weekly') {
    if (!days.length) { toast('Pick at least one day'); return null; }
    return { type:'weekly', days:[...days] };
  }
  if (mode === 'xtimes') return { type:'xtimes', times };
  return { type:'daily' };
}

function resetAddForm() {
  freqMode = 'daily'; selectedDays = []; timesPerWeek = 3;
  document.getElementById('times-val').textContent = 3;
  document.querySelectorAll('#freq-picker .freq-opt').forEach(el => el.classList.remove('active'));
  document.getElementById('fopt-daily').classList.add('active');
  document.querySelectorAll('#day-picker .day-opt').forEach(el => el.classList.remove('active'));
  document.getElementById('day-picker').classList.remove('open');
  document.getElementById('times-picker').classList.remove('open');
  document.getElementById('freq-picker').classList.remove('open');
}

function handleAdd() {
  const inp = document.getElementById('habit-input');
  const name = inp.value.trim();
  if (!name) return;
  if (habits.find(h => h.name.toLowerCase() === name.toLowerCase())) { toast('Habit already exists'); return; }
  const freq = buildFreq(freqMode, selectedDays, timesPerWeek);
  if (!freq) return;
  habits.push({ id: Date.now(), name, createdAt: Date.now(), freq });
  inp.value = '';
  inp.blur();
  resetAddForm();
  save(); render();
}

// ── TOGGLE ───────────────────────────────────────────────
function toggleHabit(id) {
  const habit = habits.find(h => h.id === id);
  if (!habit) return;
  if (isPaused(habit)) { toast('Habit is paused'); return; }
  const f = habit.freq || { type:'daily' };
  const today = new Date();

  if (f.type === 'weekly' && !isScheduled(habit, today)) {
    toast('Rest day — not scheduled today'); return;
  }
  if (f.type === 'xtimes') {
    const alreadyChecked = (log[todayStr()] || []).includes(id);
    if (!alreadyChecked && countDoneInWeekOf(id, today) >= (f.times || 1)) {
      toast('Weekly target already reached! 🎯'); return;
    }
  }

  const t = todayStr();
  if (!log[t]) log[t] = [];
  const idx = log[t].indexOf(id);
  if (idx === -1) {
    log[t].push(id);
    const scheduledToday = habits.filter(h => isScheduled(h, today));
    if (scheduledToday.length && scheduledToday.every(h => (log[t]||[]).includes(h.id))) {
      toast('🌿 All habits done today!');
    }
  } else {
    log[t].splice(idx, 1);
  }
  save(); render();
}

// ── DELETE WITH UNDO ─────────────────────────────────────
function deleteHabit(id) {
  const h = habits.find(h => h.id === id);
  if (!h) return;
  showModal('Delete habit?', '"' + h.name + '" and all its history will be removed.', 'Delete', () => {
    // Snapshot for undo
    const snapshot = {
      habit: JSON.parse(JSON.stringify(h)),
      logEntries: {}
    };
    Object.keys(log).forEach(d => {
      if (log[d].includes(id)) snapshot.logEntries[d] = [...log[d]];
    });

    habits = habits.filter(x => x.id !== id);
    Object.keys(log).forEach(d => {
      log[d] = log[d].filter(i => i !== id);
      if (!log[d].length) delete log[d];
    });
    save(); render();

    // Set up undo
    pendingUndo = {
      type: 'delete',
      data: snapshot,
      timer: setTimeout(() => { pendingUndo = null; }, 6000)
    };
    toastWithAction('Habit removed', 'Undo', undoLastDelete, 6000);
  });
}

function undoLastDelete() {
  if (!pendingUndo || pendingUndo.type !== 'delete') return;
  const snap = pendingUndo.data;
  habits.push(snap.habit);
  // Restore log entries (only ones this habit was in)
  Object.keys(snap.logEntries).forEach(d => {
    if (!log[d]) log[d] = [];
    if (!log[d].includes(snap.habit.id)) log[d].push(snap.habit.id);
  });
  clearTimeout(pendingUndo.timer);
  pendingUndo = null;
  save(); render();
  toast('Habit restored');
}

// ── EDIT HABIT ───────────────────────────────────────────
function openEditModal(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  editingId = id;

  document.getElementById('edit-name').value = h.name;

  const f = h.freq || { type:'daily' };
  editFreqMode = f.type;
  editSelectedDays = f.type === 'weekly' ? [...(f.days||[])] : [];
  editTimesPerWeek = f.type === 'xtimes' ? (f.times || 3) : 3;

  // Reset edit UI
  ['daily','weekly','xtimes'].forEach(m =>
    document.getElementById('eopt-' + m).classList.toggle('active', m === editFreqMode)
  );
  document.getElementById('edit-day-picker').classList.toggle('open', editFreqMode === 'weekly');
  document.getElementById('edit-times-picker').classList.toggle('open', editFreqMode === 'xtimes');

  document.querySelectorAll('#edit-day-picker .day-opt').forEach(el => {
    const d = parseInt(el.getAttribute('data-eday'), 10);
    el.classList.toggle('active', editSelectedDays.includes(d));
  });
  document.getElementById('edit-times-val').textContent = editTimesPerWeek;

  // Pause button label
  const pauseBtn = document.getElementById('pause-btn');
  if (isPaused(h)) {
    pauseBtn.textContent = 'Resume';
    pauseBtn.classList.add('amber');
  } else {
    pauseBtn.textContent = 'Pause';
    pauseBtn.classList.remove('amber');
  }

  document.getElementById('edit-modal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
  editingId = null;
}

function setEditFreqMode(mode) {
  editFreqMode = mode;
  ['daily','weekly','xtimes'].forEach(m =>
    document.getElementById('eopt-' + m).classList.toggle('active', m === mode)
  );
  document.getElementById('edit-day-picker').classList.toggle('open', mode === 'weekly');
  document.getElementById('edit-times-picker').classList.toggle('open', mode === 'xtimes');
}

function toggleEditDay(day) {
  const btn = document.querySelector('.day-opt[data-eday="' + day + '"]');
  if (editSelectedDays.includes(day)) {
    editSelectedDays = editSelectedDays.filter(d => d !== day);
    btn.classList.remove('active');
  } else {
    editSelectedDays.push(day);
    btn.classList.add('active');
  }
}

function changeEditTimes(delta) {
  editTimesPerWeek = Math.max(1, Math.min(7, editTimesPerWeek + delta));
  document.getElementById('edit-times-val').textContent = editTimesPerWeek;
}

function saveEditHabit() {
  if (editingId == null) return;
  const h = habits.find(x => x.id === editingId);
  if (!h) { closeEditModal(); return; }

  const newName = document.getElementById('edit-name').value.trim();
  if (!newName) { toast('Name cannot be empty'); return; }

  // Dupe check (ignoring self)
  const dupe = habits.find(x => x.id !== editingId && x.name.toLowerCase() === newName.toLowerCase());
  if (dupe) { toast('Another habit has that name'); return; }

  const newFreq = buildFreq(editFreqMode, editSelectedDays, editTimesPerWeek);
  if (!newFreq) return;

  h.name = newName;
  h.freq = newFreq;
  save(); render();
  closeEditModal();
  toast('Habit updated');
}

function togglePauseHabit() {
  if (editingId == null) return;
  const h = habits.find(x => x.id === editingId);
  if (!h) return;
  if (isPaused(h)) {
    delete h.pausedAt;
    toast('Habit resumed');
  } else {
    h.pausedAt = Date.now();
    toast('Habit paused');
  }
  save();
  closeEditModal();
  render();
}

// ── CONFIRM MODAL ────────────────────────────────────────
function showModal(title, msg, confirmText, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent   = msg;
  const btn = document.getElementById('modal-confirm');
  btn.textContent = confirmText;
  btn.onclick = () => { closeModal(); onConfirm(); };
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }

// ── TABS ─────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  ['today','weekly','calendar'].forEach(t => {
    document.getElementById('tab-' + t).style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.tab').forEach((el,i) => {
    el.classList.toggle('active', ['today','weekly','calendar'][i] === tab);
  });
  if (tab === 'weekly')   renderWeekly();
  if (tab === 'calendar') renderCalendar();
}

function setRange(days) {
  calRange = days;
  document.querySelectorAll('.range-tab').forEach(el => {
    el.classList.toggle('active', parseInt(el.getAttribute('data-range'), 10) === days);
  });
  renderCalendar();
}

// ── RENDER: TODAY ────────────────────────────────────────
function renderToday() {
  const list = document.getElementById('habits-list');
  const empty = document.getElementById('empty-state');
  if (!habits.length) { list.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  const t = todayStr();
  const today = new Date();

  // Sort: active unchecked first, then checked, then paused at bottom
  const sorted = [...habits].sort((a,b) => {
    const aP = isPaused(a) ? 1 : 0;
    const bP = isPaused(b) ? 1 : 0;
    if (aP !== bP) return aP - bP;
    const aC = (log[t]||[]).includes(a.id) ? 1 : 0;
    const bC = (log[t]||[]).includes(b.id) ? 1 : 0;
    return aC - bC;
  });

  const checkSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="' +
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() +
    '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const editSvg  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const trashSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

  list.innerHTML = sorted.map(h => {
    const paused  = isPaused(h);
    const checked = (log[t]||[]).includes(h.id);
    const rest    = !checked && !paused && isRestToday(h);
    const f       = h.freq || { type:'daily' };
    const streak  = paused ? 0 : getStreak(h);
    const label   = freqLabel(f);

    let streakHtml = '';
    if (paused) {
      streakHtml = '<span class="paused-label">⏸ Paused</span>';
    } else if (rest) {
      streakHtml = '<span class="rest-label">Rest day</span>';
    } else if (f.type === 'xtimes') {
      const done = countDoneInWeekOf(h.id, today);
      const target = f.times || 1;
      streakHtml = '<span class="streak-badge">' + done + '/' + target + ' this week' +
        (streak > 0 ? ' · 🔥 ' + streak + 'w' : '') + '</span>';
    } else {
      streakHtml = '<span class="streak-badge ' + (streak === 0 ? 'zero' : '') + '">' +
        (streak > 0 ? '🔥 ' + streak + ' day' + (streak > 1 ? 's' : '') : '— no streak') + '</span>';
    }

    const freqHtml = (label !== 'Daily' && !paused) ? '<span class="freq-badge">' + escHtml(label) + '</span>' : '';

    const classes = ['habit-row'];
    if (checked && !paused) classes.push('checked');
    if (rest)               classes.push('rest-day');
    if (paused)             classes.push('paused');

    const onclickAttr = (!rest && !paused) ? ' onclick="toggleHabit(' + h.id + ')"' : '';

    return '<div class="' + classes.join(' ') + '"' + onclickAttr + '>' +
      '<div class="habit-check">' + (checked && !paused ? checkSvg : '') + '</div>' +
      '<div class="habit-body">' +
        '<div class="habit-name">' + escHtml(h.name) + '</div>' +
        '<div class="habit-meta">' + streakHtml + freqHtml + '</div>' +
      '</div>' +
      '<div class="habit-actions">' +
        '<button class="icon-btn edit" onclick="event.stopPropagation();openEditModal(' + h.id + ')" aria-label="Edit">' + editSvg + '</button>' +
        '<button class="icon-btn delete" onclick="event.stopPropagation();deleteHabit(' + h.id + ')" aria-label="Delete">' + trashSvg + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ── RENDER: WEEKLY ───────────────────────────────────────
function renderWeekly() {
  const list = document.getElementById('weekly-list');
  if (!habits.length) { list.innerHTML = '<div class="empty"><div class="empty-sub">No habits yet</div></div>'; return; }

  const today = new Date(); today.setHours(0,0,0,0);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dd = new Date(today); dd.setDate(today.getDate() - i); days.push(dd);
  }
  const todayS = todayStr();

  list.innerHTML = habits.map(h => {
    const f = h.freq || { type:'daily' };
    const paused = isPaused(h);

    const dots = days.map(day => {
      const s = dateStr(day);
      const done = (log[s]||[]).includes(h.id);
      const sched = !paused && isScheduled(h, day);
      const isToday = s === todayS;
      let cls = !sched ? 'rest' : done ? 'done' : '';
      return '<div class="week-dot ' + cls + ' ' + (isToday ? 'today-dot' : '') + '" title="' + dayName(day) + '"></div>';
    }).join('');

    let pct;
    if (paused) pct = 0;
    else if (f.type === 'xtimes') {
      const done = countDoneInWeekOf(h.id, today);
      pct = Math.round((done / (f.times || 1)) * 100);
    } else {
      const scheduled = days.filter(day => isScheduled(h, day));
      const done = scheduled.filter(day => (log[dateStr(day)]||[]).includes(h.id)).length;
      pct = scheduled.length ? Math.round((done / scheduled.length) * 100) : 0;
    }

    const metaLabel = paused ? '⏸ Paused' : freqLabel(f);

    return '<div class="week-row">' +
      '<div class="week-name">' + escHtml(h.name) + '<small>' + escHtml(metaLabel) + '</small></div>' +
      '<div class="week-dots">' + dots + '</div>' +
      '<div class="week-pct">' + pct + '%</div>' +
    '</div>';
  }).join('');
}

// ── RENDER: CALENDAR ─────────────────────────────────────
function renderCalendar() {
  const grid = document.getElementById('cal-grid');
  const todayS = todayStr();
  const d = new Date(); d.setHours(0,0,0,0);
  const cells = [];

  // Set size class
  grid.className = 'grid range-' + calRange;

  for (let i = calRange - 1; i >= 0; i--) {
    const dd = new Date(d); dd.setDate(d.getDate() - i);
    const s = dateStr(dd);
    const checked = log[s] || [];
    const scheduled = habits.filter(h => isScheduled(h, dd));
    const total = scheduled.length;
    let cls = '';
    if (total > 0) {
      const done = scheduled.filter(h => checked.includes(h.id)).length;
      const ratio = done / total;
      if (ratio === 1) cls = 'full';
      else if (ratio > 0) cls = 'partial';
    }
    cells.push('<div class="grid-cell ' + cls + (s === todayS ? ' today' : '') + '" title="' + s + '"></div>');
  }
  grid.innerHTML = cells.join('');
}

// ── RENDER: STATS ────────────────────────────────────────
function renderStats() {
  const active = habits.filter(isActive);
  const show = habits.length > 0;
  document.getElementById('stats').style.display = show ? 'flex' : 'none';
  document.getElementById('tabs').style.display  = show ? 'flex' : 'none';
  if (!show) return;

  const t = todayStr();
  const today = new Date();
  const scheduled = active.filter(h => isScheduled(h, today));
  const checkedCnt = scheduled.filter(h => (log[t]||[]).includes(h.id)).length;

  document.getElementById('stat-today').textContent  = checkedCnt + '/' + scheduled.length;
  document.getElementById('stat-streak').textContent = getOverallBestStreak();
  document.getElementById('stat-week').textContent   = getWeekCompletion() + '%';
  document.getElementById('stat-total').textContent  = getTotalDone();
}

function renderDate() {
  const d = new Date();
  document.getElementById('date-line').textContent =
    fullDayName(d) + ', ' + monthName(d) + ' ' + d.getDate() + ' ' + d.getFullYear();
}

function render() {
  renderDate(); renderStats(); renderToday();
  if (activeTab === 'weekly')   renderWeekly();
  if (activeTab === 'calendar') renderCalendar();
}

// ── TOAST ────────────────────────────────────────────────
let toastTimer;
function toast(msg) { toastWithAction(msg, null, null, 2500); }

function toastWithAction(msg, actionLabel, onAction, duration) {
  const el = document.getElementById('toast');
  const msgEl = document.getElementById('toast-msg');
  const actBtn = document.getElementById('toast-action');

  msgEl.textContent = msg;

  if (actionLabel && onAction) {
    actBtn.textContent = actionLabel;
    actBtn.style.display = '';
    actBtn.onclick = () => {
      onAction();
      el.classList.remove('visible');
    };
  } else {
    actBtn.style.display = 'none';
    actBtn.onclick = null;
  }

  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), duration || 2500);
}

// ── NOTIFICATIONS ────────────────────────────────────────
async function initNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission === 'granted') scheduleReminder();
}

function scheduleReminder() {
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
  navigator.serviceWorker.ready.then(reg => {
    if (reg.active) reg.active.postMessage({ type: 'SCHEDULE_HABIT_REMINDER', hour: 7 });
  });
}

// ── INIT ─────────────────────────────────────────────────
document.getElementById('add-btn').disabled = false;
load();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./habit-sw.js')
      .then(() => { console.log('Habit SW registered'); initNotifications(); })
      .catch(e => console.warn('Habit SW failed:', e));
  });
}
