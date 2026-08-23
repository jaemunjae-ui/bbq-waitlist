import React, { useState, useEffect, useReducer, useRef } from 'react';
import {
  Flame, Users, LayoutGrid, Smartphone, MessageSquare, Plus, Minus,
  Phone, Clock, Check, Trash2, RefreshCw, Loader2, Info, Archive, Download
} from 'lucide-react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './lib/firebase';

/* ---------------------------------------------------------
   Style: Google Fonts + a couple of hand-rolled keyframes.
   Everything else uses Tailwind's default palette/scale.
--------------------------------------------------------- */
const FONT_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');
  @keyframes emberPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(234,88,12,0.35); }
    50% { box-shadow: 0 0 0 6px rgba(234,88,12,0); }
  }
  .ember-pulse { animation: emberPulse 2s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .ember-pulse { animation: none; }
  }
`;
const DISPLAY_FONT = { fontFamily: "'Oswald', sans-serif" };

/* ---------------------------------------------------------
   Constants
--------------------------------------------------------- */
const STORAGE_KEY = 'bbq-waitlist-state-v1';
const NOTIFY_AHEAD_THRESHOLD = 2;

const DEFAULT_TABLES = [
  { id: 't1', seats: 2 }, { id: 't2', seats: 2 },
  { id: 't3', seats: 4 }, { id: 't4', seats: 4 }, { id: 't5', seats: 4 }, { id: 't6', seats: 4 }, { id: 't7', seats: 4 },
  { id: 't8', seats: 6 }, { id: 't9', seats: 6 }, { id: 't10', seats: 6 },
  { id: 't11', seats: 8 }, { id: 't12', seats: 8 },
].map(t => ({ ...t, status: 'available', seatedAt: null, partySize: null, waitlistId: null }));

const DEFAULT_AVG_DURATIONS = { 2: 55, 4: 70, 6: 85, 8: 100 };

const TABS = [
  { id: 'waitlist', label: '대기 관리', icon: Users },
  { id: 'tables', label: '테이블 현황', icon: LayoutGrid },
  { id: 'customer', label: '고객 확인', icon: Smartphone },
  { id: 'sms', label: '문자 기록', icon: MessageSquare },
  { id: 'history', label: '매출 기록', icon: Archive },
];

/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */
let uidCounter = 0;
function uid(prefix) {
  uidCounter += 1;
  return `${prefix}${Date.now().toString(36)}${uidCounter}`;
}

function makeSms(phone, message, type) {
  return { id: uid('sms'), phone, message, type, ts: Date.now() };
}

/* ---------------------------------------------------------
   Customer-facing language support. English is the default;
   staff pick one of these per party at registration, and it
   drives both the SMS wording and the QR status screen.
--------------------------------------------------------- */
const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
];

const SMS_STRINGS = {
  en: {
    confirm: (rest, waitNumber, partySize, est) =>
      `Thanks for joining the waitlist at ${rest}! You're #${waitNumber}, party of ${partySize}. Estimated wait: ${est.min}-${est.max} min. We'll text you as your table gets close.`,
    reminder: (waitNumber, partySize, est) =>
      `You're getting close! About ${est.min}-${est.max} min left for your table (#${waitNumber}, party of ${partySize}).`,
    ready: (waitNumber) =>
      `Your table is ready! Please check in at the host stand within 10 minutes. - #${waitNumber}`,
  },
  es: {
    confirm: (rest, waitNumber, partySize, est) =>
      `¡Gracias por anotarte en la lista de espera de ${rest}! Eres el #${waitNumber}, grupo de ${partySize}. Espera estimada: ${est.min}-${est.max} min. Te avisaremos cuando se acerque tu turno.`,
    reminder: (waitNumber, partySize, est) =>
      `¡Ya casi es tu turno! Quedan aproximadamente ${est.min}-${est.max} min para tu mesa (#${waitNumber}, grupo de ${partySize}).`,
    ready: (waitNumber) =>
      `¡Tu mesa está lista! Preséntate en la recepción en los próximos 10 minutos. - #${waitNumber}`,
  },
  ko: {
    confirm: (rest, waitNumber, partySize, est) =>
      `${rest} 웨이팅에 등록되었습니다! 대기번호 #${waitNumber}번, ${partySize}명. 예상 대기시간은 ${est.min}~${est.max}분입니다. 순서가 가까워지면 문자로 안내드릴게요.`,
    reminder: (waitNumber, partySize, est) =>
      `곧 순서가 다가오고 있습니다! 약 ${est.min}~${est.max}분 후 테이블 이용이 가능합니다 (#${waitNumber}번, ${partySize}명).`,
    ready: (waitNumber) =>
      `테이블이 준비되었습니다! 10분 이내에 안내 데스크로 와주세요. - #${waitNumber}번`,
  },
  zh: {
    confirm: (rest, waitNumber, partySize, est) =>
      `感谢您在${rest}登记排队!您的排队号是 #${waitNumber},${partySize}位。预计等待时间:${est.min}-${est.max}分钟。快到您时我们会发短信通知您。`,
    reminder: (waitNumber, partySize, est) =>
      `快到您了!您的桌位预计还需 ${est.min}-${est.max} 分钟(排队号 #${waitNumber},${partySize}位)。`,
    ready: (waitNumber) =>
      `您的桌位已经准备好了!请在10分钟内到前台登记入座。- 排队号 #${waitNumber}`,
  },
};
function tSms(lang) { return SMS_STRINGS[lang] || SMS_STRINGS.en; }

const SCREEN_STRINGS = {
  en: {
    status: 'Your Waiting Status', partySize: n => `Party Size: ${n}`,
    ready: '🔥 Your table is ready! Please check in at the host stand.',
    estimatedWait: 'Estimated Wait', min: 'MIN',
    next: "You're next!", almostReady: 'You are almost ready!',
    ahead: n => `There ${n === 1 ? 'is' : 'are'} ${n} ${n === 1 ? 'party' : 'parties'} ahead of you.`,
    seated: "You're seated! Enjoy your meal.", completed: 'Thanks for dining with us today!',
    cancelled: 'This waitlist ticket is no longer active.',
    carNote: "You may wait in your car or nearby. We'll text you as your table gets close, and this page updates on its own.",
    notFound: "We couldn't find this waitlist ticket. It may have expired, or your table may already be ready - please check with the host stand.",
    kioskHeading: 'Join the Waitlist', partySizeLabel: 'Party Size', phoneLabel: 'Phone Number',
    joinButton: 'Join Waitlist', phoneError: 'Please enter a valid 10-digit phone number.',
    confirmHeading: "You're on the list!", doneButton: 'Done',
  },
  es: {
    status: 'Estado de tu espera', partySize: n => `Tamaño del grupo: ${n}`,
    ready: '🔥 ¡Tu mesa está lista! Preséntate en la recepción.',
    estimatedWait: 'Espera estimada', min: 'MIN',
    next: '¡Eres el siguiente!', almostReady: '¡Ya casi es tu turno!',
    ahead: n => `Hay ${n} ${n === 1 ? 'grupo' : 'grupos'} antes que tú.`,
    seated: '¡Ya estás en tu mesa! Buen provecho.', completed: '¡Gracias por comer con nosotros hoy!',
    cancelled: 'Este ticket de espera ya no está activo.',
    carNote: 'Puedes esperar en tu auto o cerca del restaurante. Te avisaremos cuando se acerque tu turno; esta página se actualiza sola.',
    notFound: 'No pudimos encontrar este ticket de espera. Puede que haya expirado, o que tu mesa ya esté lista - consulta en la recepción.',
    kioskHeading: 'Únete a la Lista de Espera', partySizeLabel: 'Tamaño del Grupo', phoneLabel: 'Número de Teléfono',
    joinButton: 'Unirme a la Lista', phoneError: 'Ingresa un número de teléfono válido de 10 dígitos.',
    confirmHeading: '¡Ya estás en la lista!', doneButton: 'Listo',
  },
  ko: {
    status: '나의 대기 현황', partySize: n => `인원수: ${n}명`,
    ready: '🔥 테이블이 준비되었습니다! 안내 데스크로 와주세요.',
    estimatedWait: '예상 대기시간', min: '분',
    next: '다음 차례입니다!', almostReady: '거의 다 되었습니다!',
    ahead: n => `앞으로 ${n}팀 남았습니다.`,
    seated: '착석하셨습니다! 맛있게 드세요.', completed: '오늘 방문해주셔서 감사합니다!',
    cancelled: '이 대기 티켓은 더 이상 유효하지 않습니다.',
    carNote: '차에서 기다리셔도 됩니다. 순서가 가까워지면 문자로 안내드리며, 이 화면은 자동으로 갱신됩니다.',
    notFound: '대기 티켓 정보를 찾을 수 없습니다. 유효기간이 지났거나 이미 착석 처리되었을 수 있습니다. 안내 데스크에 문의해주세요.',
    kioskHeading: '웨이팅 등록', partySizeLabel: '인원수', phoneLabel: '전화번호',
    joinButton: '등록하기', phoneError: '전화번호 10자리를 정확히 입력해주세요.',
    confirmHeading: '등록이 완료되었습니다!', doneButton: '완료',
  },
  zh: {
    status: '您的排队状态', partySize: n => `用餐人数:${n}位`,
    ready: '🔥 您的桌位已经准备好了!请到前台登记。',
    estimatedWait: '预计等待时间', min: '分钟',
    next: '马上轮到您了!', almostReady: '快轮到您了!',
    ahead: n => `前面还有 ${n} 组。`,
    seated: '您已入座!祝您用餐愉快。', completed: '感谢您今天的光临!',
    cancelled: '此排队信息已失效。',
    carNote: '您可以在车里或附近等候。快到您时我们会发短信通知,此页面也会自动更新。',
    notFound: '未找到该排队信息,可能已过期或已完成入座,请到前台查询。',
    kioskHeading: '加入排队', partySizeLabel: '用餐人数', phoneLabel: '电话号码',
    joinButton: '立即登记', phoneError: '请输入正确的10位电话号码。',
    confirmHeading: '登记成功!', doneButton: '完成',
  },
};
function tScreen(lang) { return SCREEN_STRINGS[lang] || SCREEN_STRINGS.en; }

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  const len = digits.length;
  if (len === 0) return '';
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Local-calendar-day key (not UTC), since a "business day" should follow
// the restaurant's own clock, not the server's.
function todayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function statusLabel(s) {
  return { waiting: '대기중', called: '호출됨', seated: '착석', completed: '완료', cancelled: '노쇼/취소' }[s] || s;
}

function computeDayStats(entries) {
  const count = entries.length;
  const totalGuests = entries.reduce((sum, e) => sum + (e.partySize || 0), 0);
  const noShow = entries.filter(e => e.status === 'cancelled').length;
  const avgParty = count > 0 ? totalGuests / count : 0;
  return { count, totalGuests, noShow, avgParty };
}

// Plain browser download - no libraries needed. UTF-8 BOM up front so Excel
// (including Korean-locale Excel) opens the file with correct encoding
// instead of garbled text.
function downloadCsv(filename, headers, rows) {
  const esc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))];
  const csv = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportEntriesCsv(filename, entries) {
  const headers = ['날짜', '대기번호', '인원수', '언어', '접수시각', '상태'];
  const rows = entries.map(e => [
    todayKey(e.joinedAt),
    e.waitNumber,
    e.partySize,
    (LANGUAGES.find(l => l.code === e.language) || LANGUAGES[0]).label,
    new Date(e.joinedAt).toLocaleString('ko-KR', { hour12: false }),
    statusLabel(e.status),
  ]);
  downloadCsv(filename, headers, rows);
}

function formatElapsed(startTs, nowTs) {
  const mins = Math.max(0, Math.floor((nowTs - startTs) / 60000));
  if (mins < 60) return `${mins}분`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}시간 ${m}분`;
}

function getBucket(partySize, tables) {
  const sizes = Array.from(new Set(tables.map(t => t.seats))).sort((a, b) => a - b);
  const fit = sizes.find(s => s >= partySize);
  return fit !== undefined ? fit : (sizes[sizes.length - 1] || partySize);
}

function getDefaultDuration(bucket) {
  return Math.max(30, Math.round(55 + (bucket - 2) * 7.5));
}

// The core estimate: not "waiting parties x 20 min". It looks at how many
// tables of the right size actually exist, which of those are occupied
// right now (and how long ago they were seated), and how many parties are
// really ahead in that size bucket - then projects forward from there.
function computeWaitEstimate(partySize, tables, aheadCount, avgDurations, nowTs) {
  const bucket = getBucket(partySize, tables);
  const bucketTables = tables.filter(t => t.seats === bucket);
  const c = bucketTables.length || 1;
  const avgD = avgDurations[bucket] || getDefaultDuration(bucket);
  const availableNow = bucketTables.filter(t => t.status === 'available').length;
  const position = aheadCount + 1;

  if (availableNow >= position) {
    return { min: 5, max: 10 };
  }

  const occupied = bucketTables.filter(t => t.status !== 'available');
  const remaining = occupied
    .map(t => {
      const elapsedMin = t.seatedAt ? (nowTs - t.seatedAt) / 60000 : 0;
      return Math.max(5, avgD - elapsedMin);
    })
    .sort((a, b) => a - b);

  const needIndex = position - availableNow;
  let waitMin;
  if (needIndex <= remaining.length) {
    waitMin = remaining[needIndex - 1];
  } else {
    const extraRounds = Math.ceil((needIndex - remaining.length) / c);
    const base = remaining.length ? remaining[remaining.length - 1] : avgD;
    waitMin = base + extraRounds * avgD;
  }

  const lo = Math.max(5, Math.floor((waitMin * 0.85) / 5) * 5);
  const hi = Math.max(lo + 5, Math.ceil((waitMin * 1.15) / 5) * 5);
  return { min: lo, max: hi };
}

function findBestAvailableTable(partySize, tables) {
  const candidates = tables
    .filter(t => t.status === 'available' && t.seats >= partySize)
    .sort((a, b) => a.seats - b.seats);
  return candidates[0] || null;
}

/* ---------------------------------------------------------
   State
--------------------------------------------------------- */
const initialState = {
  restaurantName: 'BBQ AYCE',
  tables: DEFAULT_TABLES,
  waitlist: [],
  smsLog: [],
  avgDurations: { ...DEFAULT_AVG_DURATIONS },
  nextWaitNumber: 1,
  servedToday: 0,
  updatedAt: 0,
  history: {},
  currentDay: todayKey(),
  pricePerPerson: 0,
};

// Moves everything currently in state.waitlist into the permanent history
// log, then clears the board for a new day. Each entry is filed under its
// own joinedAt date (not one blanket date), so a party that checked in just
// after midnight - before the rollover effect has had a chance to fire -
// still lands on the correct day instead of bleeding into the day before.
// Used by both the manual reset button and the automatic day-boundary check.
function archiveAndReset(state, nowTs) {
  const clearedTables = state.tables.map(t => ({ ...t, status: 'available', seatedAt: null, partySize: null, waitlistId: null }));
  const today = todayKey(nowTs);
  if (state.waitlist.length === 0) {
    return { ...state, smsLog: [], servedToday: 0, nextWaitNumber: 1, tables: clearedTables, currentDay: today };
  }
  const newHistory = { ...state.history };
  for (const entry of state.waitlist) {
    const key = todayKey(entry.joinedAt);
    const existing = (newHistory[key] && newHistory[key].entries) || [];
    newHistory[key] = { entries: [...existing, entry] };
  }
  return {
    ...state,
    history: newHistory,
    waitlist: [],
    smsLog: [],
    servedToday: 0,
    nextWaitNumber: 1,
    tables: clearedTables,
    currentDay: today,
  };
}

function waitlistReducer(state, action) {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.payload };

    case 'SET_NAME':
      return { ...state, restaurantName: action.payload };

    case 'ADD_WAITLIST': {
      const { partySize, phone, language } = action.payload;
      const lang = language || 'en';
      const bucket = getBucket(partySize, state.tables);
      const aheadCount = state.waitlist.filter(w =>
        (w.status === 'waiting' || w.status === 'called') &&
        getBucket(w.partySize, state.tables) === bucket
      ).length;
      const est = computeWaitEstimate(partySize, state.tables, aheadCount, state.avgDurations, Date.now());
      const waitNumber = state.nextWaitNumber;
      const entry = {
        id: uid('w'),
        waitNumber,
        partySize,
        phone,
        language: lang,
        joinedAt: Date.now(),
        status: 'waiting',
        notified: false,
        estMin: est.min,
        estMax: est.max,
      };
      const msg = tSms(lang).confirm(state.restaurantName, waitNumber, partySize, est);
      return {
        ...state,
        waitlist: [...state.waitlist, entry],
        nextWaitNumber: state.nextWaitNumber + 1,
        smsLog: [...state.smsLog, makeSms(phone, msg, 'confirm')],
      };
    }

    case 'AUTO_NOTIFY': {
      const items = action.payload;
      const ids = new Set(items.map(i => i.id));
      const logs = items.map(i => makeSms(
        i.phone,
        tSms(i.language).reminder(i.waitNumber, i.partySize, i.est),
        'reminder'
      ));
      return {
        ...state,
        waitlist: state.waitlist.map(w => ids.has(w.id) ? { ...w, notified: true } : w),
        smsLog: [...state.smsLog, ...logs],
      };
    }

    case 'MANUAL_NOTIFY': {
      const entry = state.waitlist.find(w => w.id === action.payload.id);
      if (!entry) return state;
      const bucket = getBucket(entry.partySize, state.tables);
      const ahead = state.waitlist.filter(w =>
        (w.status === 'waiting' || w.status === 'called') && w.id !== entry.id &&
        getBucket(w.partySize, state.tables) === bucket && w.joinedAt < entry.joinedAt
      ).length;
      const est = computeWaitEstimate(entry.partySize, state.tables, ahead, state.avgDurations, Date.now());
      const msg = tSms(entry.language).reminder(entry.waitNumber, entry.partySize, est);
      return {
        ...state,
        waitlist: state.waitlist.map(w => w.id === entry.id ? { ...w, notified: true } : w),
        smsLog: [...state.smsLog, makeSms(entry.phone, msg, 'reminder')],
      };
    }

    case 'TABLE_READY': {
      const { entryId, tableId } = action.payload;
      const entry = state.waitlist.find(w => w.id === entryId);
      if (!entry) return state;
      const msg = tSms(entry.language).ready(entry.waitNumber);
      return {
        ...state,
        tables: state.tables.map(t => t.id === tableId
          ? { ...t, status: 'reserved', seatedAt: null, partySize: entry.partySize, waitlistId: entry.id }
          : t
        ),
        waitlist: state.waitlist.map(w => w.id === entryId ? { ...w, status: 'called' } : w),
        smsLog: [...state.smsLog, makeSms(entry.phone, msg, 'ready')],
      };
    }

    case 'CHECK_IN': {
      const { tableId } = action.payload;
      const table = state.tables.find(t => t.id === tableId);
      if (!table) return state;
      return {
        ...state,
        tables: state.tables.map(t => t.id === tableId ? { ...t, status: 'occupied', seatedAt: Date.now() } : t),
        waitlist: table.waitlistId
          ? state.waitlist.map(w => w.id === table.waitlistId ? { ...w, status: 'seated' } : w)
          : state.waitlist,
      };
    }

    case 'CLEAR_TABLE': {
      const { tableId } = action.payload;
      const table = state.tables.find(t => t.id === tableId);
      if (!table) return state;
      let avgDurations = state.avgDurations;
      let servedToday = state.servedToday;
      let waitlist = state.waitlist;

      if (table.status === 'occupied' && table.seatedAt) {
        const actual = (Date.now() - table.seatedAt) / 60000;
        const prev = avgDurations[table.seats];
        const updated = prev ? prev * 0.75 + actual * 0.25 : actual;
        avgDurations = { ...avgDurations, [table.seats]: Math.round(updated) };
        servedToday = servedToday + 1;
        if (table.waitlistId) {
          waitlist = waitlist.map(w => w.id === table.waitlistId ? { ...w, status: 'completed' } : w);
        }
      } else if (table.waitlistId) {
        waitlist = waitlist.map(w => w.id === table.waitlistId ? { ...w, status: 'cancelled' } : w);
      }

      return {
        ...state,
        avgDurations,
        servedToday,
        waitlist,
        tables: state.tables.map(t => t.id === tableId
          ? { ...t, status: 'available', seatedAt: null, partySize: null, waitlistId: null }
          : t
        ),
      };
    }

    case 'WALK_IN': {
      const { tableId, partySize } = action.payload;
      return {
        ...state,
        tables: state.tables.map(t => t.id === tableId
          ? { ...t, status: 'occupied', seatedAt: Date.now(), partySize, waitlistId: null }
          : t
        ),
      };
    }

    case 'CANCEL_ENTRY': {
      const { id } = action.payload;
      return {
        ...state,
        waitlist: state.waitlist.map(w => w.id === id ? { ...w, status: 'cancelled' } : w),
        tables: state.tables.map(t => t.waitlistId === id
          ? { ...t, status: 'available', seatedAt: null, partySize: null, waitlistId: null }
          : t
        ),
      };
    }

    case 'ADD_TABLE': {
      const seats = action.payload.seats;
      const newTable = { id: uid('t'), seats, status: 'available', seatedAt: null, partySize: null, waitlistId: null };
      return { ...state, tables: [...state.tables, newTable] };
    }

    case 'REMOVE_TABLE': {
      return { ...state, tables: state.tables.filter(t => t.id !== action.payload.id) };
    }

    case 'RESET_DAY': {
      return archiveAndReset(state, Date.now());
    }

    // Silent day-boundary rollover, so a forgotten manual reset doesn't
    // bucket two different calendar days' guests under one date.
    case 'ROLL_DAY': {
      return archiveAndReset(state, Date.now());
    }

    case 'SET_PRICE':
      return { ...state, pricePerPerson: action.payload };

    default:
      return state;
  }
}

// Wraps waitlistReducer so every real change gets a fresh updatedAt stamp.
// The kiosk iPad and the staff iPad each poll shared storage and compare
// this value against their own copy to know when to pull in the other's changes.
function reducer(state, action) {
  const next = waitlistReducer(state, action);
  if (next === state || action.type === 'HYDRATE') return next;
  return { ...next, updatedAt: Date.now() };
}

/* ---------------------------------------------------------
   Small components
--------------------------------------------------------- */
function LiveClock() {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>;
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-stone-500 truncate">{label}</div>
        <div style={DISPLAY_FONT} className="text-xl font-semibold text-stone-900 truncate">{value}</div>
      </div>
    </div>
  );
}

function AddWaitlistForm({ onSubmit }) {
  const [partySize, setPartySize] = useState(2);
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState('en');
  const [error, setError] = useState('');

  function submit(e) {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) { setError('전화번호 10자리를 입력해주세요.'); return; }
    setError('');
    onSubmit({ partySize, phone, language });
    setPartySize(2); setPhone(''); setLanguage('en');
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
      <h3 style={DISPLAY_FONT} className="font-semibold text-stone-800 text-base">새 대기 등록</h3>
      <div>
        <label className="text-xs font-medium text-stone-500 block mb-1">인원수</label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPartySize(p => Math.max(1, p - 1))} className="w-9 h-9 rounded-lg border border-stone-300 flex items-center justify-center hover:bg-stone-50">
            <Minus className="w-4 h-4" />
          </button>
          <span className="w-10 text-center font-medium">{partySize}명</span>
          <button type="button" onClick={() => setPartySize(p => Math.min(20, p + 1))} className="w-9 h-9 rounded-lg border border-stone-300 flex items-center justify-center hover:bg-stone-50">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-stone-500 block mb-1">전화번호</label>
        <input
          value={phone}
          onChange={e => setPhone(formatPhone(e.target.value))}
          placeholder="(213) 555-1234"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-stone-500 block mb-1">손님 언어 (문자·고객 확인 화면 언어)</label>
        <div className="grid grid-cols-4 gap-1.5">
          {LANGUAGES.map(l => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLanguage(l.code)}
              className={`text-xs font-medium rounded-lg py-2 flex flex-col items-center gap-0.5 border transition-colors ${
                language === l.code ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-stone-300 text-stone-500 hover:bg-stone-50'
              }`}
            >
              <span className="text-base leading-none">{l.flag}</span>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="text-xs text-red-500">{error}</div>}
      <button type="submit" className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg py-2.5 text-sm transition-colors">
        대기 등록
      </button>
    </form>
  );
}

function AddTableForm({ onAdd }) {
  const [seats, setSeats] = useState(4);
  return (
    <div className="flex items-center gap-2">
      <input
        type="number" min={1} max={20} value={seats}
        onChange={e => setSeats(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
        className="w-16 border border-stone-300 rounded-lg px-2 py-1.5 text-sm"
      />
      <button onClick={() => onAdd(seats)} className="text-sm font-medium bg-stone-800 text-white rounded-lg px-3 py-1.5 hover:bg-stone-700 flex items-center gap-1 transition-colors">
        <Plus className="w-4 h-4" /> 테이블 추가
      </button>
    </div>
  );
}

function TableCard({ table, avgDurations, now, onCheckIn, onClear, onWalkIn, onRemove }) {
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [walkInSize, setWalkInSize] = useState(Math.min(2, table.seats));

  const statusStyle = {
    available: 'border-green-300 bg-green-50',
    reserved: 'border-amber-400 bg-amber-50',
    occupied: 'border-red-300 bg-red-50',
  }[table.status];
  const statusLabel = { available: '이용 가능', reserved: '준비됨 · 체크인 대기', occupied: '이용 중' }[table.status];
  const elapsed = table.seatedAt ? Math.floor((now - table.seatedAt) / 60000) : 0;
  const avgD = avgDurations[table.seats] || getDefaultDuration(table.seats);

  return (
    <div className={`rounded-xl border-2 p-3 ${statusStyle} ${table.status === 'reserved' ? 'ember-pulse' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-stone-800 text-sm">테이블 · {table.seats}인석</span>
        {table.status === 'available' && (
          <button onClick={() => onRemove(table.id)} className="text-stone-400 hover:text-red-500" aria-label="테이블 삭제">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="text-xs text-stone-500 mb-2">{statusLabel}</div>

      {table.status === 'occupied' && (
        <div className="text-xs text-stone-600 mb-2">{elapsed}분 경과 (평균 {Math.round(avgD)}분)</div>
      )}

      {table.status === 'available' && (
        showWalkIn ? (
          <div className="flex items-center gap-1 mt-1">
            <input
              type="number" min={1} max={table.seats} value={walkInSize}
              onChange={e => setWalkInSize(Math.max(1, Math.min(table.seats, Number(e.target.value) || 1)))}
              className="w-12 border border-stone-300 rounded px-1 py-1 text-sm"
            />
            <button onClick={() => { onWalkIn(table.id, walkInSize); setShowWalkIn(false); }} className="text-xs bg-stone-800 text-white rounded px-2 py-1 hover:bg-stone-700">착석</button>
            <button onClick={() => setShowWalkIn(false)} className="text-xs text-stone-400 px-1">취소</button>
          </div>
        ) : (
          <button onClick={() => setShowWalkIn(true)} className="text-xs text-stone-600 border border-stone-300 rounded-lg px-2 py-1.5 hover:bg-white w-full transition-colors">
            워크인 착석
          </button>
        )
      )}
      {table.status === 'reserved' && (
        <div className="space-y-1">
          <button onClick={() => onCheckIn(table.id)} className="text-xs bg-orange-600 text-white rounded-lg px-2 py-1.5 w-full hover:bg-orange-700 transition-colors">체크인</button>
          <button onClick={() => onClear(table.id)} className="text-xs text-stone-400 hover:text-red-500 w-full">노쇼 처리</button>
        </div>
      )}
      {table.status === 'occupied' && (
        <button onClick={() => onClear(table.id)} className="text-xs bg-stone-800 text-white rounded-lg px-2 py-1.5 w-full hover:bg-stone-700 transition-colors">테이블 비우기</button>
      )}
    </div>
  );
}

function WaitlistRow({ entry, state, now, onReady, onNotify, onCancel, onCheckIn }) {
  const bucket = getBucket(entry.partySize, state.tables);
  const ahead = state.waitlist.filter(w =>
    (w.status === 'waiting' || w.status === 'called') && w.id !== entry.id &&
    getBucket(w.partySize, state.tables) === bucket && w.joinedAt < entry.joinedAt
  ).length;
  const est = computeWaitEstimate(entry.partySize, state.tables, ahead, state.avgDurations, now);
  const bestTable = findBestAvailableTable(entry.partySize, state.tables);
  const linkedTable = state.tables.find(t => t.waitlistId === entry.id);

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div style={DISPLAY_FONT} className="text-2xl font-bold text-stone-800 w-14 text-center">#{entry.waitNumber}</div>
          <div>
            <div className="font-medium text-stone-800 flex items-center gap-1.5">
              {entry.partySize}명
              <span className="text-sm" title={(LANGUAGES.find(l => l.code === entry.language) || LANGUAGES[0]).label}>
                {(LANGUAGES.find(l => l.code === entry.language) || LANGUAGES[0]).flag}
              </span>
            </div>
            <div className="text-xs text-stone-500 flex items-center gap-1 flex-wrap">
              <Phone className="w-3 h-3" />{entry.phone}
              <span className="mx-0.5">·</span>
              <Clock className="w-3 h-3" />{formatElapsed(entry.joinedAt, now)} 경과
            </div>
          </div>
        </div>
        <div className="text-right">
          {entry.status === 'called' ? (
            <span className="ember-pulse inline-flex items-center gap-1 bg-orange-100 text-orange-700 text-xs font-medium px-2.5 py-1 rounded-full">
              🔥 테이블 준비됨
            </span>
          ) : (
            <>
              <div style={DISPLAY_FONT} className="text-lg font-semibold text-stone-800">{est.min}–{est.max}분</div>
              <div className="text-xs text-stone-500">{ahead === 0 ? '다음 차례예요' : `앞에 ${ahead}팀`}</div>
            </>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        {entry.status === 'waiting' && (
          <>
            <button
              disabled={!bestTable}
              onClick={() => bestTable && onReady(entry.id, bestTable.id)}
              title={!bestTable ? '이용 가능한 테이블이 없습니다' : ''}
              className="text-xs font-medium bg-orange-600 disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 hover:bg-orange-700 transition-colors"
            >
              테이블 준비완료
            </button>
            <button onClick={() => onNotify(entry.id)} className="text-xs font-medium border border-stone-300 text-stone-600 rounded-lg px-3 py-1.5 hover:bg-stone-50 transition-colors">
              알림 발송
            </button>
          </>
        )}
        {entry.status === 'called' && linkedTable && (
          <button onClick={() => onCheckIn(linkedTable.id)} className="text-xs font-medium bg-stone-800 text-white rounded-lg px-3 py-1.5 hover:bg-stone-700 transition-colors">
            체크인 완료
          </button>
        )}
        <button onClick={() => onCancel(entry.id)} className="text-xs font-medium text-red-500 rounded-lg px-3 py-1.5 hover:bg-red-50 transition-colors">
          취소
        </button>
      </div>
    </div>
  );
}

function CustomerTab({ state, now }) {
  const [query, setQuery] = useState('');
  const digits = query.replace(/\D/g, '');
  const candidates = digits.length >= 4
    ? state.waitlist.filter(w => (w.status === 'waiting' || w.status === 'called') && w.phone.replace(/\D/g, '').endsWith(digits))
    : [];
  const match = [...candidates].sort((a, b) => b.joinedAt - a.joinedAt)[0] || null;

  let ahead = 0;
  let est = { min: 0, max: 0 };
  if (match) {
    const bucket = getBucket(match.partySize, state.tables);
    ahead = state.waitlist.filter(w =>
      (w.status === 'waiting' || w.status === 'called') && w.id !== match.id &&
      getBucket(w.partySize, state.tables) === bucket && w.joinedAt < match.joinedAt
    ).length;
    est = computeWaitEstimate(match.partySize, state.tables, ahead, state.avgDurations, now);
  }

  return (
    <div className="max-w-md mx-auto">
      <p className="text-sm text-stone-500 text-center mb-4">손님이 전화번호로 본인의 대기 현황을 확인하는 화면입니다. 직원이 이 화면을 손님에게 보여주거나, 별도 태블릿을 손님 확인용으로 놓아두시면 됩니다.</p>
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mb-4">
        <label className="text-sm font-medium text-stone-700 block mb-2">Enter your phone number</label>
        <input
          value={query}
          onChange={e => setQuery(formatPhone(e.target.value))}
          placeholder="(213) 555-1234"
          className="w-full border border-stone-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>

      {digits.length >= 4 && !match && (
        <div className="text-center text-stone-500 text-sm py-8">No active waitlist entry found for this number.</div>
      )}

      {match && (() => {
        const t = tScreen(match.language);
        return (
        <div className="bg-white rounded-2xl border-2 border-stone-200 shadow-md overflow-hidden">
          <div className="bg-stone-900 text-stone-300 text-center text-xs tracking-widest uppercase py-2">{t.status}</div>
          <div className="text-center py-6 px-5">
            <div style={DISPLAY_FONT} className="text-7xl font-bold text-orange-600 leading-none">
              #{String(match.waitNumber).padStart(3, '0')}
            </div>
            <div className="text-stone-600 mt-2">{t.partySize(match.partySize)}</div>
          </div>
          <div className="border-t-2 border-dashed border-stone-300 mx-5" />
          <div className="p-5 text-center">
            {match.status === 'called' ? (
              <div className="ember-pulse bg-orange-100 text-orange-800 rounded-xl py-4 px-3 font-medium">
                {t.ready}
              </div>
            ) : (
              <>
                <div className="text-xs uppercase tracking-widest text-stone-400 mb-1">{t.estimatedWait}</div>
                <div style={DISPLAY_FONT} className="text-4xl font-semibold text-stone-900">
                  {est.min}–{est.max} <span className="text-lg">{t.min}</span>
                </div>
                {ahead <= NOTIFY_AHEAD_THRESHOLD ? (
                  <div className="ember-pulse mt-3 inline-block bg-orange-100 text-orange-700 text-sm font-medium px-3 py-1.5 rounded-full">
                    {ahead === 0 ? t.next : t.almostReady}
                  </div>
                ) : (
                  <div className="text-sm text-stone-500 mt-2">{t.ahead(ahead)}</div>
                )}
              </>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

// Self-service registration kiosk - this is the whole screen on the
// customer-facing iPad. No staff controls live here at all.
function CustomerKioskScreen({ state, dispatch, onSwitchToStaff }) {
  const [step, setStep] = useState('language'); // 'language' | 'form' | 'confirm'
  const [language, setLanguage] = useState('en');
  const [partySize, setPartySize] = useState(2);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(null);
  const t = tScreen(language);

  function resetKiosk() {
    setStep('language');
    setPartySize(2);
    setPhone('');
    setError('');
    setConfirmed(null);
  }

  // Idle safety net: if a party finishes (or abandons) and walks off without
  // tapping through, hand the kiosk back to a clean state for the next party
  // rather than leaving their ticket number on screen indefinitely.
  useEffect(() => {
    if (step === 'language') return;
    const id = setTimeout(resetKiosk, 60000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, partySize, phone]);

  function submit(e) {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) { setError(t.phoneError); return; }
    setError('');
    // Mirror the reducer's own math so the number shown here always matches
    // exactly what ADD_WAITLIST is about to assign - no guessing, no race.
    const bucket = getBucket(partySize, state.tables);
    const aheadCount = state.waitlist.filter(w =>
      (w.status === 'waiting' || w.status === 'called') &&
      getBucket(w.partySize, state.tables) === bucket
    ).length;
    const est = computeWaitEstimate(partySize, state.tables, aheadCount, state.avgDurations, Date.now());
    const waitNumber = state.nextWaitNumber;
    dispatch({ type: 'ADD_WAITLIST', payload: { partySize, phone, language } });
    setConfirmed({ waitNumber, partySize, est });
    setStep('confirm');
  }

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col items-center justify-center p-6" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{FONT_STYLE}</style>
      <div className="flex items-center gap-2 text-stone-600 mb-6">
        <Flame className="w-6 h-6 text-orange-500" />
        <span style={DISPLAY_FONT} className="text-xl font-semibold">{state.restaurantName}</span>
      </div>

      <div className="w-full max-w-md">
        {step === 'language' && (
          <div className="bg-white rounded-2xl border border-stone-200 shadow-md p-6">
            <div className="text-center text-stone-400 text-xs tracking-wide mb-5">Language · 언어 · Idioma · 语言</div>
            <div className="grid grid-cols-2 gap-3">
              {LANGUAGES.map(l => (
                <button
                  key={l.code}
                  onClick={() => { setLanguage(l.code); setStep('form'); }}
                  className="flex flex-col items-center gap-1.5 border-2 border-stone-200 hover:border-orange-400 hover:bg-orange-50 rounded-xl py-6 transition-colors"
                >
                  <span className="text-4xl leading-none">{l.flag}</span>
                  <span className="font-medium text-stone-700">{l.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'form' && (
          <form onSubmit={submit} className="bg-white rounded-2xl border border-stone-200 shadow-md p-6 space-y-5">
            <h2 style={DISPLAY_FONT} className="text-2xl font-semibold text-stone-800 text-center">{t.kioskHeading}</h2>
            <div>
              <label className="text-sm font-medium text-stone-600 block mb-2 text-center">{t.partySizeLabel}</label>
              <div className="flex items-center justify-center gap-4">
                <button type="button" onClick={() => setPartySize(p => Math.max(1, p - 1))} className="w-14 h-14 rounded-full border-2 border-stone-300 flex items-center justify-center hover:bg-stone-50 active:bg-stone-100">
                  <Minus className="w-6 h-6" />
                </button>
                <span style={DISPLAY_FONT} className="text-4xl font-semibold w-16 text-center">{partySize}</span>
                <button type="button" onClick={() => setPartySize(p => Math.min(20, p + 1))} className="w-14 h-14 rounded-full border-2 border-stone-300 flex items-center justify-center hover:bg-stone-50 active:bg-stone-100">
                  <Plus className="w-6 h-6" />
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-stone-600 block mb-2 text-center">{t.phoneLabel}</label>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={e => setPhone(formatPhone(e.target.value))}
                placeholder="(213) 555-1234"
                className="w-full border-2 border-stone-300 rounded-xl px-4 py-3 text-lg text-center focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            {error && <div className="text-sm text-red-500 text-center">{error}</div>}
            <button type="submit" className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl py-4 text-lg transition-colors">
              {t.joinButton}
            </button>
          </form>
        )}

        {step === 'confirm' && confirmed && (
          <div className="bg-white rounded-2xl border-2 border-stone-200 shadow-md overflow-hidden">
            <div className="bg-stone-900 text-stone-300 text-center text-xs tracking-widest uppercase py-2">{t.confirmHeading}</div>
            <div className="text-center py-8 px-5">
              <div style={DISPLAY_FONT} className="text-8xl font-bold text-orange-600 leading-none">
                #{String(confirmed.waitNumber).padStart(3, '0')}
              </div>
              <div className="text-stone-600 mt-3 text-lg">{t.partySize(confirmed.partySize)}</div>
            </div>
            <div className="border-t-2 border-dashed border-stone-300 mx-5" />
            <div className="p-6 text-center">
              <div className="text-xs uppercase tracking-widest text-stone-400 mb-1">{t.estimatedWait}</div>
              <div style={DISPLAY_FONT} className="text-4xl font-semibold text-stone-900">
                {confirmed.est.min}–{confirmed.est.max} <span className="text-lg">{t.min}</span>
              </div>
            </div>
            <div className="p-5 pt-0">
              <button onClick={resetKiosk} className="w-full bg-stone-800 hover:bg-stone-700 text-white font-medium rounded-xl py-3.5 transition-colors">
                {t.doneButton}
              </button>
            </div>
          </div>
        )}
      </div>

      <button onClick={onSwitchToStaff} className="mt-8 text-stone-300 hover:text-stone-400 text-xs">
        직원용
      </button>
    </div>
  );
}

/* ---------------------------------------------------------
   Main app
--------------------------------------------------------- */
export default function BBQWaitlistApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [activeTab, setActiveTab] = useState('waitlist');
  const [toast, setToast] = useState(null);
  const [nameDraft, setNameDraft] = useState(initialState.restaurantName);
  const [priceDraft, setPriceDraft] = useState('');
  const [resetArmed, setResetArmed] = useState(false);
  // Which of the two iPads this browser tab is acting as. Detected from the
  // URL hash on load (so a reload of the same tab remembers it), and
  // switchable in-app via the small link in each screen.
  const [mode, setMode] = useState(() => (window.location.hash === '#customer' ? 'customer' : 'staff'));
  function switchMode(next) {
    window.location.hash = next === 'customer' ? 'customer' : '';
    setMode(next);
  }
  const stateRef = useRef(state);
  stateRef.current = state;
  // Set right before applying a poll's HYDRATE, so the very next persist
  // effect run knows to skip - otherwise we'd immediately re-save data we
  // only just pulled in from the other iPad.
  const skipNextSaveRef = useRef(false);

  // Subscribe to the shared Firestore document once on mount. This both
  // loads the initial state and keeps the two iPads in sync in real time -
  // Firestore fires the callback immediately with the current doc, then
  // again on every remote write, so no separate load-once effect or polling
  // interval is needed. Only apply a snapshot if it's actually newer than
  // what this tab has, so a write in flight from this tab doesn't get
  // clobbered by its own not-yet-settled read.
  useEffect(() => {
    const ref = doc(db, 'state', STORAGE_KEY);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const payload = snap.data();
        if ((payload.updatedAt || 0) > (stateRef.current.updatedAt || 0)) {
          skipNextSaveRef.current = true;
          dispatch({ type: 'HYDRATE', payload });
        }
      }
      setLoading(false);
    }, (e) => {
      // Transient read failure - the listener keeps retrying on its own.
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!loading) {
      setNameDraft(state.restaurantName);
      setPriceDraft(state.pricePerPerson > 0 ? String(state.pricePerPerson) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Live tick for elapsed-time / estimate displays.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Catches a forgotten manual reset: if the calendar day has moved on
  // since state.currentDay was last set, silently archive that day's
  // records and roll over - staff-side only, so the kiosk never races it.
  useEffect(() => {
    if (mode !== 'staff' || loading) return;
    if (todayKey(now) !== state.currentDay) {
      dispatch({ type: 'ROLL_DAY' });
    }
  }, [now, state.currentDay, mode, loading]);

  // Persist on every meaningful change (from either iPad). Debounced: a
  // registration can trigger a second change (the "getting close" check)
  // in the very same tick, and firing two writes back-to-back is wasteful.
  // Waiting a beat and saving once fixes that. If a save still fails, retry
  // with a slowly growing wait between attempts - a network hiccup can take
  // longer than a couple quick retries to clear.
  useEffect(() => {
    if (loading) return;
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    const payload = {
      restaurantName: state.restaurantName,
      tables: state.tables,
      waitlist: state.waitlist,
      smsLog: state.smsLog,
      avgDurations: state.avgDurations,
      nextWaitNumber: state.nextWaitNumber,
      servedToday: state.servedToday,
      updatedAt: state.updatedAt,
      history: state.history,
      currentDay: state.currentDay,
      pricePerPerson: state.pricePerPerson,
    };
    const backoffMs = [1000, 2000, 4000, 8000];
    const debounceId = setTimeout(() => {
      (async () => {
        const ref = doc(db, 'state', STORAGE_KEY);
        for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
          try {
            await setDoc(ref, payload);
            return;
          } catch (e) {
            if (attempt < backoffMs.length) await new Promise(r => setTimeout(r, backoffMs[attempt]));
          }
        }
        setToast({ type: 'error', message: '저장에 실패했습니다. 인터넷 연결을 확인해주세요.' });
      })();
    }, 700);
    return () => clearTimeout(debounceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, loading]);

  // Auto reminder text once a party is within the "getting close" threshold.
  // Staff-side only, so the kiosk iPad never independently fires its own
  // copy of the same reminder.
  useEffect(() => {
    if (mode !== 'staff') return;
    const active = state.waitlist.filter(w => w.status === 'waiting' || w.status === 'called');
    const toNotify = [];
    for (const entry of state.waitlist) {
      if (entry.status !== 'waiting' || entry.notified) continue;
      const bucket = getBucket(entry.partySize, state.tables);
      const ahead = active.filter(w => w.id !== entry.id && getBucket(w.partySize, state.tables) === bucket && w.joinedAt < entry.joinedAt).length;
      if (ahead <= NOTIFY_AHEAD_THRESHOLD) {
        const est = computeWaitEstimate(entry.partySize, state.tables, ahead, state.avgDurations, Date.now());
        toNotify.push({ id: entry.id, phone: entry.phone, waitNumber: entry.waitNumber, partySize: entry.partySize, language: entry.language, est });
      }
    }
    if (toNotify.length > 0) {
      dispatch({ type: 'AUTO_NOTIFY', payload: toNotify });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.waitlist, state.tables, mode]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  function handleResetClick() {
    if (!resetArmed) {
      setResetArmed(true);
      setTimeout(() => setResetArmed(false), 4000);
      return;
    }
    dispatch({ type: 'RESET_DAY' });
    setResetArmed(false);
    setToast({ type: 'success', message: '오늘 데이터를 초기화했습니다.' });
  }

  const activeWaitlist = [...state.waitlist]
    .filter(w => w.status === 'waiting' || w.status === 'called')
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const waitingOnly = activeWaitlist.filter(w => w.status === 'waiting');
  const availableCount = state.tables.filter(t => t.status === 'available').length;

  let avgWaitLabel = '-';
  if (waitingOnly.length > 0) {
    const sums = waitingOnly.map(entry => {
      const bucket = getBucket(entry.partySize, state.tables);
      const ahead = activeWaitlist.filter(w => w.status === 'waiting' && w.id !== entry.id && getBucket(w.partySize, state.tables) === bucket && w.joinedAt < entry.joinedAt).length;
      const est = computeWaitEstimate(entry.partySize, state.tables, ahead, state.avgDurations, now);
      return (est.min + est.max) / 2;
    });
    avgWaitLabel = `${Math.round(sums.reduce((a, b) => a + b, 0) / sums.length)}분`;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-100">
        <style>{FONT_STYLE}</style>
        <div className="flex flex-col items-center gap-3 text-stone-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <div className="text-sm">불러오는 중...</div>
        </div>
      </div>
    );
  }

  if (mode === 'customer') {
    return <CustomerKioskScreen state={state} dispatch={dispatch} onSwitchToStaff={() => switchMode('staff')} />;
  }

  return (
    <div className="min-h-screen bg-stone-100" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{FONT_STYLE}</style>

      <header className="bg-stone-900 text-stone-50 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Flame className="w-6 h-6 text-orange-500 shrink-0" />
            <input
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={() => {
                const trimmed = nameDraft.trim();
                if (trimmed && trimmed !== state.restaurantName) dispatch({ type: 'SET_NAME', payload: trimmed });
              }}
              style={DISPLAY_FONT}
              className="text-lg sm:text-xl font-semibold bg-transparent border-b border-transparent hover:border-stone-600 focus:border-orange-500 focus:outline-none min-w-0 truncate"
              aria-label="식당 이름"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={() => switchMode('customer')}
              className="flex items-center gap-1.5 text-xs font-medium text-stone-300 border border-stone-600 rounded-lg px-2.5 py-1.5 hover:bg-stone-800 transition-colors"
            >
              <Smartphone className="w-3.5 h-3.5" /> 손님용 등록 화면
            </button>
            <div className="text-sm text-stone-400 tabular-nums"><LiveClock /></div>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors focus:outline-none ${
                activeTab === tab.id ? 'border-orange-500 text-white' : 'border-transparent text-stone-400 hover:text-stone-200'
              }`}
            >
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5">
        {activeTab === 'waitlist' && (
          <div>
            <div className="flex justify-end mb-2">
              <button
                onClick={handleResetClick}
                className={`text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg border transition-colors ${
                  resetArmed ? 'border-red-400 text-red-600 bg-red-50' : 'border-stone-300 text-stone-500 hover:bg-stone-50'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" /> {resetArmed ? '다시 클릭하면 초기화됩니다' : '오늘 데이터 초기화'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <StatCard label="대기 중" value={`${activeWaitlist.length}팀`} icon={Users} />
              <StatCard label="이용 가능 테이블" value={`${availableCount}/${state.tables.length}`} icon={LayoutGrid} />
              <StatCard label="평균 예상 대기" value={avgWaitLabel} icon={Clock} />
              <StatCard label="오늘 입장 손님" value={`${state.servedToday}명`} icon={Check} />
            </div>
            <div className="grid lg:grid-cols-3 gap-5">
              <div className="lg:col-span-1">
                <AddWaitlistForm onSubmit={payload => {
                  dispatch({ type: 'ADD_WAITLIST', payload });
                  setToast({ type: 'success', message: '대기 등록 완료 · 확인 문자를 발송했습니다.' });
                }} />
              </div>
              <div className="lg:col-span-2 space-y-2">
                {activeWaitlist.length === 0 ? (
                  <div className="text-center text-stone-400 text-sm py-16 bg-white rounded-xl border border-dashed border-stone-300">
                    현재 대기 중인 팀이 없습니다.
                  </div>
                ) : activeWaitlist.map(entry => (
                  <WaitlistRow
                    key={entry.id}
                    entry={entry}
                    state={state}
                    now={now}
                    onReady={(id, tid) => {
                      dispatch({ type: 'TABLE_READY', payload: { entryId: id, tableId: tid } });
                      setToast({ type: 'success', message: '테이블 준비 문자를 발송했습니다.' });
                    }}
                    onNotify={id => {
                      dispatch({ type: 'MANUAL_NOTIFY', payload: { id } });
                      setToast({ type: 'success', message: '알림 문자를 발송했습니다.' });
                    }}
                    onCancel={id => dispatch({ type: 'CANCEL_ENTRY', payload: { id } })}
                    onCheckIn={tid => dispatch({ type: 'CHECK_IN', payload: { tableId: tid } })}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tables' && (
          <div>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 style={DISPLAY_FONT} className="text-lg font-semibold text-stone-800">테이블 현황</h2>
              <AddTableForm onAdd={seats => dispatch({ type: 'ADD_TABLE', payload: { seats } })} />
            </div>
            <div className="text-xs text-stone-500 mb-3 flex flex-wrap gap-x-4 gap-y-1">
              <span className="font-medium text-stone-600">평균 식사 시간</span>
              {Object.entries(state.avgDurations).sort((a, b) => Number(a[0]) - Number(b[0])).map(([seats, dur]) => (
                <span key={seats}>{seats}인석 {Math.round(dur)}분</span>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {state.tables.map(table => (
                <TableCard
                  key={table.id}
                  table={table}
                  avgDurations={state.avgDurations}
                  now={now}
                  onCheckIn={tid => dispatch({ type: 'CHECK_IN', payload: { tableId: tid } })}
                  onClear={tid => {
                    dispatch({ type: 'CLEAR_TABLE', payload: { tableId: tid } });
                    setToast({ type: 'success', message: '테이블을 정리했습니다.' });
                  }}
                  onWalkIn={(tid, size) => dispatch({ type: 'WALK_IN', payload: { tableId: tid, partySize: size } })}
                  onRemove={tid => dispatch({ type: 'REMOVE_TABLE', payload: { id: tid } })}
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'customer' && <CustomerTab state={state} now={now} />}

        {activeTab === 'sms' && (
          <div>
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 mb-4 flex gap-2 items-start">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <div>이 목록은 실제로 발송된 문자가 아닌 <span className="font-medium">발송 시뮬레이션 기록</span>입니다. 실제 문자 발송 연동 방법은 채팅 답변을 참고해주세요.</div>
            </div>
            {state.smsLog.length === 0 ? (
              <div className="text-center text-stone-400 text-sm py-16 bg-white rounded-xl border border-dashed border-stone-300">
                발송된 문자가 없습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {[...state.smsLog].reverse().map(sms => (
                  <div key={sms.id} className="bg-white rounded-xl border border-stone-200 p-3 flex items-start gap-3">
                    <div className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${
                      sms.type === 'ready' ? 'bg-orange-100 text-orange-700' : sms.type === 'reminder' ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-600'
                    }`}>
                      {sms.type === 'ready' ? '테이블 준비' : sms.type === 'reminder' ? '리마인더' : '등록 확인'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-stone-500 mb-0.5">
                        {sms.phone} · {new Date(sms.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </div>
                      <div className="text-sm text-stone-700">{sms.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (() => {
          const todayStats = computeDayStats(state.waitlist);
          const days = Object.entries(state.history).sort((a, b) => b[0].localeCompare(a[0]));
          const price = state.pricePerPerson;
          return (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 flex gap-2 items-start">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div>"초기화"를 누르면 그날의 대기 기록이 여기에 자동으로 저장됩니다. 자정이 지나도록 초기화를 누르지 않으면 다음 날 자동으로 저장 후 넘어갑니다.</div>
              </div>

              <div className="bg-white rounded-xl border border-stone-200 p-4 flex items-center gap-3 flex-wrap">
                <label className="text-sm font-medium text-stone-600">인당 가격 (선택, 매출 추정용)</label>
                <div className="flex items-center gap-1">
                  <span className="text-stone-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceDraft}
                    onChange={e => setPriceDraft(e.target.value)}
                    onBlur={() => {
                      const v = parseFloat(priceDraft);
                      dispatch({ type: 'SET_PRICE', payload: isNaN(v) || v < 0 ? 0 : v });
                    }}
                    placeholder="예: 28"
                    className="w-24 border border-stone-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                {price > 0 && (
                  <span className="text-xs text-stone-400">* 예상 매출 = 인당 가격 × 총 인원 (실제 결제 금액과 다를 수 있는 추정치)</span>
                )}
                {days.length > 0 && (
                  <button
                    onClick={() => exportEntriesCsv(`대기기록_전체_${todayKey(now)}.csv`, days.flatMap(([, rec]) => rec.entries))}
                    className="ml-auto flex items-center gap-1.5 text-xs font-medium border border-stone-300 text-stone-600 rounded-lg px-2.5 py-1.5 hover:bg-stone-50"
                  >
                    <Download className="w-3.5 h-3.5" /> 전체 기록 CSV
                  </button>
                )}
              </div>

              <div className="bg-white rounded-xl border-2 border-orange-200 p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div style={DISPLAY_FONT} className="font-semibold text-stone-800">오늘 · 진행중 ({todayKey(now)})</div>
                  <button
                    disabled={state.waitlist.length === 0}
                    onClick={() => exportEntriesCsv(`대기기록_${todayKey(now)}.csv`, state.waitlist)}
                    className="flex items-center gap-1.5 text-xs font-medium border border-stone-300 text-stone-600 rounded-lg px-2.5 py-1.5 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><span className="text-stone-400">접수</span> <span className="font-medium text-stone-800">{todayStats.count}팀</span></div>
                  <div><span className="text-stone-400">총 인원</span> <span className="font-medium text-stone-800">{todayStats.totalGuests}명</span></div>
                  <div><span className="text-stone-400">평균</span> <span className="font-medium text-stone-800">{todayStats.avgParty.toFixed(1)}명/팀</span></div>
                  {price > 0 ? (
                    <div><span className="text-stone-400">예상 매출</span> <span className="font-medium text-orange-700">${(todayStats.totalGuests * price).toLocaleString()}</span></div>
                  ) : (
                    <div><span className="text-stone-400">노쇼</span> <span className="font-medium text-stone-800">{todayStats.noShow}팀</span></div>
                  )}
                </div>
              </div>

              {days.length === 0 ? (
                <div className="text-center text-stone-400 text-sm py-16 bg-white rounded-xl border border-dashed border-stone-300">
                  아직 마감된 날짜 기록이 없습니다.
                </div>
              ) : (
                days.map(([day, rec]) => {
                  const stats = computeDayStats(rec.entries);
                  return (
                    <div key={day} className="bg-white rounded-xl border border-stone-200 p-4">
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <div style={DISPLAY_FONT} className="font-semibold text-stone-800">{day}</div>
                        <button
                          onClick={() => exportEntriesCsv(`대기기록_${day}.csv`, rec.entries)}
                          className="flex items-center gap-1.5 text-xs font-medium border border-stone-300 text-stone-600 rounded-lg px-2.5 py-1.5 hover:bg-stone-50"
                        >
                          <Download className="w-3.5 h-3.5" /> CSV
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div><span className="text-stone-400">접수</span> <span className="font-medium text-stone-800">{stats.count}팀</span></div>
                        <div><span className="text-stone-400">총 인원</span> <span className="font-medium text-stone-800">{stats.totalGuests}명</span></div>
                        <div><span className="text-stone-400">평균</span> <span className="font-medium text-stone-800">{stats.avgParty.toFixed(1)}명/팀</span></div>
                        {price > 0 ? (
                          <div><span className="text-stone-400">예상 매출</span> <span className="font-medium text-orange-700">${(stats.totalGuests * price).toLocaleString()}</span></div>
                        ) : (
                          <div><span className="text-stone-400">노쇼</span> <span className="font-medium text-stone-800">{stats.noShow}팀</span></div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}
      </main>

      {toast && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium z-30 ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-stone-900 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
