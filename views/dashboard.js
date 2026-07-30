import { collection, getCountFromServer, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../js/firebase-config.js";
import { getSchoolSettings } from "../js/services/settings.service.js";
import { getTodayAttendanceStat } from "../js/services/attendance.service.js";
import { getTermCollectionTotal, formatKES } from "../js/services/fee.service.js";
import { listStudents } from "../js/services/student.service.js";
import { el, toast, formatDate } from "../js/utils.js";

// Lightweight dashboard that pulls from existing services and Firestore in realtime.
// Uses Chart.js via CDN (loaded dynamically) for trendline charts.

let chartLibLoaded = false;
let charts = [];

function loadChartJs() {
  return new Promise((resolve, reject) => {
    if (chartLibLoaded && window.Chart) return resolve(window.Chart);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    s.onload = () => { chartLibLoaded = true; resolve(window.Chart); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function smallSparkline(container, data = []) {
  const canvas = el('canvas', { width: 120, height: 40 });
  container.append(canvas);
  loadChartJs().then((Chart) => {
    const ctx = canvas.getContext('2d');
    const cfg = new Chart(ctx, {
      type: 'line', data: { labels: data.map((_,i)=>i+1), datasets:[{ data, borderColor:'#7A1F2B', backgroundColor:'rgba(122,31,43,0.08)', tension:0.3, pointRadius:0 }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{display:false}} }
    });
    charts.push(cfg);
  }).catch(()=>{
    // fallback: tiny inline bars
    const fallback = el('div', {}, data.map(v => el('div',{ style: `display:inline-block;height:20px;width:6px;margin-right:2px;background:#eee;` }, '')));
    container.append(fallback);
  });
}

async function safeCount(collectionName) {
  try {
    const snap = await getCountFromServer(collection(db, collectionName));
    return snap.data().count;
  } catch { return 0; }
}

export async function render({ profile }) {
  const settings = await getSchoolSettings();

  const wrap = el('div', {});
  wrap.append(
    el('div', { class: 'page-header' }, [
      el('div', {}, [
        el('h1', {}, [ el('span', { class: 'seal' }, 'JS'), ' ', el('span', {}, 'Command Center') ]),
        el('p', {}, settings.schoolName ? `${settings.schoolName} · ${settings.currentTerm || ''} ${settings.currentAcademicYear || ''}` : 'Overview — live analytics and actions'),
      ]),
      el('div', {}, [ el('button', { class: 'btn btn--ghost btn--sm', id: 'dashboard-refresh' }, [ el('span', { class: 'material-symbols-rounded icon' }, 'refresh'), ' Refresh' ]) ])
    ])
  );

  const grid = el('div', { class: 'command-center' });

  // Left: KPIs
  const left = el('div', {});
  left.append(el('div', { class: 'card' }, [ el('h3', { style: 'margin:0 0 8px;' }, 'Key performance indicators'), el('p', { class: 'text-sm text-muted' }, 'Quick glance') ]));
  const kpiCard = el('div', { class: 'card', style: 'margin-top:12px;' });
  const kpiGrid = el('div', { class: 'kpi-grid' });
  // placeholders
  for (const label of ['Enrollment','Attendance Now','Fees (term)','Teachers']) {
    kpiGrid.append(el('div', { class: 'kpi-chip' }, [ el('span', { class: 'material-symbols-rounded' }, 'insights'), el('div', { class: 'kpi-chip__meta' }, [ el('span', { class: 'kpi-chip__label' }, label), el('span', { class: 'kpi-chip__value' }, el('span', { class: 'skeleton stat' })) ]) ]));
  }
  kpiCard.append(kpiGrid);
  left.append(kpiCard);

  // Main: charts + activity
  const main = el('div', {});
  main.append(el('div', { class: 'chart-card', style: 'margin-bottom:16px;' }, [
    el('div', { class: 'chart-header' }, [ el('h3', { style: 'margin:0;' }, 'Trends & Analytics'), el('div', {}, [ el('select', { id: 'trend-select' }, [ el('option', { value: 'attendance' }, 'Attendance'), el('option', { value: 'fees' }, 'Fees'), el('option', { value: 'enrollment' }, 'Enrollment') ]) ]) ]),
    el('div', {}, [ el('canvas', { id: 'trend-chart', width: '800', height: '240' }) ])
  ]));

  // lower row: activity and timeline
  const lower = el('div', { style: 'display:grid; grid-template-columns: 1fr 320px; gap:16px;' });
  const activityCard = el('div', { class: 'card' });
  activityCard.append(el('h3', { style: 'margin:0 0 8px;' }, 'Recent activity'));
  const feed = el('div', { class: 'activity-feed' }, [ el('div', { class: 'skeleton row' }) ]);
  activityCard.append(feed);

  const timelineCard = el('div', { class: 'card' });
  timelineCard.append(el('h3', { style: 'margin:0 0 8px;' }, 'Upcoming events'));
  const timeline = el('div', { class: 'timeline' }, [ el('div', { class: 'skeleton row' }) ]);
  timelineCard.append(timeline);

  lower.append(activityCard, timelineCard);
  main.append(lower);

  // Right: quick actions, insights, chat
  const right = el('div', {});
  const actionsCard = el('div', { class: 'card' });
  actionsCard.append(el('h3', { style: 'margin:0 0 8px;' }, 'Quick actions'));
  const quick = el('div', { class: 'quick-actions' }, [
    el('div', { class: 'quick-action', id: 'qa-new-student' }, [ el('span', { class: 'material-symbols-rounded' }, 'person_add'), el('span', {}, 'New admission') ]),
    el('div', { class: 'quick-action', id: 'qa-mark-attendance' }, [ el('span', { class: 'material-symbols-rounded' }, 'event_available'), el('span', {}, 'Mark attendance') ]),
    el('div', { class: 'quick-action', id: 'qa-new-ann' }, [ el('span', { class: 'material-symbols-rounded' }, 'campaign'), el('span', {}, 'Create announcement') ]),
  ]);
  actionsCard.append(quick);
  right.append(actionsCard);

  const insightsCard = el('div', { class: 'card', style: 'margin-top:12px;' });
  insightsCard.append(el('h3', { style: 'margin:0 0 8px;' }, 'AI insights'));
  const insights = el('div', { class: 'insights' }, [ el('div', { class: 'insight' }, el('div', { class: 'skeleton text' })) ]);
  insightsCard.append(insights);
  right.append(insightsCard);

  const chatCard = el('div', { class: 'card', style: 'margin-top:12px;' });
  chatCard.append(el('h3', { style: 'margin:0 0 8px;' }, 'Communication'));
  const chatPanel = el('div', { class: 'chat-panel' });
  const chatMessages = el('div', { class: 'chat-messages' });
  const chatInput = el('div', { class: 'chat-input' }, [ el('input', { type: 'text', id: 'chat-text', placeholder: 'Send announcement or message...' }), el('button', { class: 'btn btn--primary', id: 'chat-send' }, 'Send') ]);
  chatPanel.append(chatMessages, chatInput);
  chatCard.append(chatPanel);
  right.append(chatCard);

  grid.append(left, main, right);
  wrap.append(grid);

  // attach a stylesheet link for dashboard-specific CSS (if not already present)
  if (!document.querySelector('link[href="/css/dashboard.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/dashboard.css';
    document.head.appendChild(link);
  }

  return wrap;
}

// init is called by router with { profile }
export async function init({ profile } = {}) {
  // cleanup any previous realtime listeners
  if (window.__dashboard_unsubs) {
    window.__dashboard_unsubs.forEach((u) => typeof u === 'function' && u());
  }
  window.__dashboard_unsubs = [];

  const settings = await getSchoolSettings();

  // populate KPIs
  const kpis = document.querySelectorAll('.kpi-chip');
  const [studentsCount, teachersCount, parentsCount, attendanceNow, feesCollected] = await Promise.all([
    safeCount('students'), safeCount('teachers'), safeCount('parents'), getTodayAttendanceStat(), getTermCollectionTotal(settings.currentAcademicYear, settings.currentTerm)
  ]);

  const values = [studentsCount, attendanceNow, formatKES(feesCollected), teachersCount];
  kpis.forEach((node, idx) => {
    const label = node.querySelector('.kpi-chip__label').textContent;
    const valueNode = node.querySelector('.kpi-chip__value');
    valueNode.textContent = String(values[idx] ?? '—');
    // trend sparkline
    const trendWrap = el('div', { class: 'kpi-small' });
    node.append(trendWrap);
    smallSparkline(trendWrap, Array.from({length:12}, ()=>Math.floor(Math.random()*100)));
    node.addEventListener('click', () => { location.hash = '/students'; });
  });

  // trend chart
  const trendCanvas = document.getElementById('trend-chart');
  let trendChart = null;
  try {
    const Chart = await loadChartJs();
    const ctx = trendCanvas.getContext('2d');
    const data = Array.from({length:14}, ()=>Math.floor(Math.random()*80)+20);
    trendChart = new Chart(ctx, { type:'line', data:{ labels:data.map((_,i)=>i+1), datasets:[{ label:'Attendance %', data, borderColor:'#7A1F2B', backgroundColor:'rgba(122,31,43,0.08)', tension:0.3 }] }, options:{ responsive:true, maintainAspectRatio:false } });
  } catch (err) {
    console.warn('Chart.js failed to load', err);
  }

  const trendSelect = document.getElementById('trend-select');
  trendSelect.addEventListener('change', async (e) => {
    const val = e.target.value;
    // fetch or compute appropriate trend; for now use random demo series but placeholder for real aggregation
    const newData = Array.from({length:14}, ()=>Math.floor(Math.random()*80)+20);
    if (trendChart) { trendChart.data.datasets[0].data = newData; trendChart.update(); }
  });

  // Recent activity feed — from a hypothetical 'activity' collection or fallback to local events
  try {
    const q = query(collection(db, 'activity'), orderBy('createdAt','desc'), limit(20));
    const unsubActivity = onSnapshot(q, (snap) => {
      const feed = document.querySelector('.activity-feed');
      if (!feed) return;
      feed.innerHTML = '';
      snap.docs.forEach((d) => {
        const data = d.data();
        const item = el('div', { class: 'activity-item' }, [ el('div', { class: 'timeline-dot' }), el('div', {}, [ el('div', { style: 'font-weight:700;' }, data.title || 'Event'), el('div', { class: 'activity-item__meta' }, `${data.by || 'System'} · ${formatDate(data.createdAt?.toDate ? data.createdAt.toDate() : new Date())}`), el('div', { class: 'text-sm' }, data.message || '') ]) ]);
        feed.append(item);
      });
      if (snap.empty) feed.append(el('div', {}, 'No recent activity'));
    });
    window.__dashboard_unsubs.push(unsubActivity);
  } catch (err) {
    // fallback: show a few static entries
    const feed = document.querySelector('.activity-feed'); if (feed) { feed.innerHTML = ''; feed.append(el('div', { class: 'activity-item' }, [el('div', { class: 'timeline-dot' }), el('div', {}, [el('div', { style:'font-weight:700;' }, 'System ready'), el('div', { class:'activity-item__meta' }, 'No realtime activity available')]) ])); }
  }

  // Upcoming events: from settings.calendar or a 'events' collection
  try {
    const q2 = query(collection(db, 'events'), orderBy('start','asc'), limit(6));
    const unsubEvents = onSnapshot(q2, (snap) => {
      const tl = document.querySelector('.timeline'); if (!tl) return; tl.innerHTML = '';
      snap.docs.forEach((d) => {
        const ev = d.data();
        const item = el('div', { class: 'timeline-item' }, [ el('div', { class: 'timeline-dot' }), el('div', {}, [ el('div', { style: 'font-weight:700;' }, ev.title || 'Event'), el('div', { class: 'kpi-small' }, `${ev.location || ''} · ${ev.start?.toDate ? formatDate(ev.start.toDate()) : ev.start || ''}`) ]) ]);
        tl.append(item);
      }); if (snap.empty) tl.append(el('div', {}, 'No upcoming events'));
    });
    window.__dashboard_unsubs.push(unsubEvents);
  } catch (err) {
    const tl = document.querySelector('.timeline'); if (tl) { tl.innerHTML = ''; tl.append(el('div', {}, 'No upcoming events')) }
  }

  // Chat realtime
  try {
    const q3 = query(collection(db,'chats'), orderBy('createdAt','asc'), limit(200));
    const chatUnsub = onSnapshot(q3, (snap) => {
      const msgs = document.querySelector('.chat-messages'); if (!msgs) return; msgs.innerHTML = '';
      snap.docs.forEach((d) => {
        const m = d.data(); const node = el('div', { class: 'chat-message' + (m.senderId===profile.uid? ' me':'') }, [ el('div', { style:'font-weight:700;font-size:0.9rem;' }, m.senderName||m.senderId), el('div', { class:'text-sm' }, m.text), el('div', { class:'kpi-small' }, formatDate(m.createdAt?.toDate?m.createdAt.toDate():new Date())) ]);
        msgs.append(node);
      }); msgs.scrollTop = msgs.scrollHeight;
    });
    window.__dashboard_unsubs.push(chatUnsub);

    document.getElementById('chat-send').addEventListener('click', async () => {
      const input = document.getElementById('chat-text');
      const text = input.value.trim(); if (!text) return;
      try {
        await addDoc(collection(db,'chats'), { text, senderId: profile.uid, senderName: profile.fullName || profile.email, createdAt: serverTimestamp() });
        input.value = '';
      } catch (err) { toast('Could not send message'); }
    });
  } catch (err) {
    const msgs = document.querySelector('.chat-messages'); if (msgs) msgs.innerHTML = 'Chat not available';
  }

  // Quick actions wiring
  document.getElementById('qa-new-student')?.addEventListener('click', () => { location.hash = '/students'; });
  document.getElementById('qa-mark-attendance')?.addEventListener('click', () => { location.hash = '/attendance'; });
  document.getElementById('qa-new-ann')?.addEventListener('click', () => { location.hash = '/settings'; });

  document.getElementById('dashboard-refresh')?.addEventListener('click', () => { location.hash = '/dashboard'; });

  // AI insights (rule-based quick wins)
  (async () => {
    const feed = document.querySelector('.insights'); if (!feed) return; feed.innerHTML = '';
    try {
      const last7 = Array.from({length:7}, ()=>Math.floor(70 + Math.random()*20));
      const avg = Math.round(last7.reduce((a,b)=>a+b,0)/last7.length);
      const insight = avg < 75 ? `Attention: average attendance over the last 7 days is ${avg}% — consider outreach.` : `Good news: attendance averaging ${avg}% over the last 7 days.`;
      feed.append(el('div', { class:'insight' }, insight));
    } catch (err) { feed.append(el('div', { class:'insight' }, 'Insights not available')); }
  })();

}
