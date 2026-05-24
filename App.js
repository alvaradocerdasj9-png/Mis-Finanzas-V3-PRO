/**
 * Mis Finanzas v2.0 Pro
 *
 * Basado en v1.3 por ALVA
 *
 * Cambios v2.0 Pro:
 * ✅ Pantalla principal muestra solo movimientos de HOY ("Movimientos del día")
 * ✅ Navegación multi-pantalla via currentScreen state (main / account / charts)
 * ✅ Nueva pantalla "Estado de cuenta" — agrupada por día, estilo bancario
 * ✅ Calendario mejorado: dots de actividad, heatmap de intensidad, glow en hoy
 * ✅ Swipe para eliminar en movimientos del día
 * ✅ Botón finalizar dinámico según período (Finalizar día/semana/quincena/mes)
 * ✅ PDF/CSV/Compartir movidos a pantalla de estado de cuenta
 * ✅ Gráficas barras (ingresos vs gastos por día) en pantalla de estado de cuenta
 * ✅ Badge de movimientos en botón "Consultar movimientos" del drawer
 * ✅ Mini resumen con balance del período en el drawer
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  FlatList, Modal, Share, KeyboardAvoidingView,
  Platform, StatusBar, Animated, Keyboard, ScrollView,
  Dimensions, PanResponder,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

// ─────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH  = Math.min(SCREEN_WIDTH * 0.80, 320);
const LISTS_KEY     = 'finanzas_lists_v1';
const ACTIVE_KEY    = 'finanzas_active_list_v1';

// Claves legacy v1.2
const LEGACY_MOVEMENTS_KEY = 'finanzas_movimientos_v1';
const LEGACY_HISTORY_KEY   = 'finanzas_history_v1';
const LEGACY_CURRENCY_KEY  = 'finanzas_currency_v1';
const LEGACY_PERIOD_KEY    = 'finanzas_period_v1';
const LEGACY_BUDGET_KEY    = 'finanzas_budget_v1';

const CURRENCIES = [
  { symbol: '₡', code: 'CRC', label: 'Colón' },
  { symbol: '$', code: 'USD', label: 'Dólar' },
  { symbol: '€', code: 'EUR', label: 'Euro'  },
];

const PERIODS = ['Diario', 'Semanal', 'Bisemanal', 'Quincenal', 'Mensual'];

const LIST_COLORS = [
  '#4f8ef7',
  '#4fcf8a',
  '#e07070',
  '#e0b84a',
  '#b07ef7',
];

const MAX_LISTS = 5;

// ─────────────────────────────────────────
// PALETA
// ─────────────────────────────────────────
const C = {
  bg:          '#0d1520',
  surface:     '#131f30',
  surface2:    '#1a2840',
  surface3:    '#223350',
  accent:      '#4f8ef7',
  accent2:     '#7eb3ff',
  accentGlow:  'rgba(79,142,247,0.15)',
  income:      '#4fcf8a',
  income2:     '#7edba8',
  expense:     '#e07070',
  expense2:    '#f0a0a0',
  text:        '#e0eaf8',
  text2:       '#8aaacf',
  text3:       '#4a6080',
  border:      'rgba(79,142,247,0.18)',
  drawerBg:    '#0b1525',
  warning:     '#e0b84a',
};

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
const getLocale = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().locale || 'es-CR'; }
  catch { return 'es-CR'; }
};

const fmt = (n, symbol = '₡') => {
  const abs = Math.abs(Math.round(n));
  return `${symbol} ${abs.toLocaleString(getLocale())}`;
};

const todayStr = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};

const parseDateStr = (str) => {
  const p = str.split('/');
  if (p.length !== 3) return new Date();
  return new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]));
};

const isToday = (dateStr) => {
  const d = parseDateStr(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth()    === now.getMonth()    &&
         d.getDate()     === now.getDate();
};

const isInPeriod = (dateStr, period) => {
  const d     = parseDateStr(dateStr);
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === 'Diario') {
    const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return itemDay.getTime() === today.getTime();
  }
  if (period === 'Semanal') {
    const dow = today.getDay();
    const mon = new Date(today); mon.setDate(today.getDate() - ((dow+6)%7));
    const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
    const id  = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return id >= mon && id <= sun;
  }
  if (period === 'Bisemanal') {
    const dow = today.getDay();
    const mon = new Date(today); mon.setDate(today.getDate() - ((dow+6)%7));
    const twoAgo = new Date(mon); twoAgo.setDate(mon.getDate() - 14);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const id  = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return id >= twoAgo && id <= sun;
  }
  if (period === 'Quincenal') {
    const day = now.getDate();
    if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
    return day <= 15 ? (d.getDate() >= 1 && d.getDate() <= 15) : d.getDate() >= 16;
  }
  if (period === 'Mensual') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  return true;
};

const createList = ({ name, color, currency, period }) => ({
  id:        Date.now().toString() + Math.random().toString(36).slice(2),
  name:      name || 'Mi presupuesto',
  color:     color || LIST_COLORS[0],
  currency:  currency || CURRENCIES[0],
  period:    period  || 'Mensual',
  budget:    0,
  movements: [],
  history:   [],
});

const periodLabel = (period) => {
  switch (period) {
    case 'Diario':     return 'día';
    case 'Semanal':    return 'semana';
    case 'Bisemanal':  return 'quincena';
    case 'Quincenal':  return 'quincena';
    case 'Mensual':    return 'mes';
    default:           return 'período';
  }
};

const periodConfirmLabel = (period) => {
  switch (period) {
    case 'Diario':     return '¿Cerrar el día de hoy?';
    case 'Semanal':    return '¿Cerrar la semana actual?';
    case 'Bisemanal':  return '¿Cerrar las últimas 2 semanas?';
    case 'Quincenal':  return '¿Cerrar la quincena actual?';
    case 'Mensual': {
      const m = new Date().toLocaleString('es-CR', { month: 'long' });
      return `¿Cerrar el mes de ${m}?`;
    }
    default: return '¿Cerrar el período?';
  }
};

// Agrupa movimientos por fecha (más reciente primero)
const groupByDate = (movements) => {
  const map = {};
  movements.forEach(m => {
    if (!map[m.date]) map[m.date] = [];
    map[m.date].push(m);
  });
  return Object.entries(map)
    .sort(([a], [b]) => parseDateStr(b) - parseDateStr(a))
    .map(([date, items]) => ({ date, items }));
};

const formatDateFull = (dateStr) => {
  try {
    const d = parseDateStr(dateStr);
    return d.toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { return dateStr; }
};

// ─────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────
const load    = async (key, fallback) => {
  try { const v = await AsyncStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};
const persist = async (key, value) => {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch {}
};

// ─────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────
export default function App() {
  const [mostrarSplash, setMostrarSplash] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setMostrarSplash(false), 2500);
    return () => clearTimeout(t);
  }, []);

  if (mostrarSplash) {
    return (
      <View style={s.splashContainer}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.splashContent}>
          <Text style={s.splashEmoji}>💰</Text>
          <Text style={s.splashTitle}>Mis Finanzas</Text>
          <Text style={s.splashSubtitle}>Tu balance personal inteligente</Text>
        </View>
        <View style={s.splashFooter}>
          <Text style={s.splashVersion}>v2.0 Pro</Text>
          <Text style={s.splashCredits}>Desarrollado por ALVA</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <SafeAreaProvider>
        <AppInner />
      </SafeAreaProvider>
    </View>
  );
}

// ─────────────────────────────────────────
// CALENDAR PICKER MEJORADO
// ─────────────────────────────────────────
const DAYS_ES   = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function CalendarPicker({ visible, currentDateStr, onConfirm, onCancel, movements = [] }) {
  const today   = new Date();
  const initDate = (() => {
    if (!currentDateStr) return today;
    const p = currentDateStr.split('/');
    if (p.length !== 3) return today;
    return new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]));
  })();

  const [viewYear,  setViewYear]  = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());
  const [selected,  setSelected]  = useState(initDate);

  useEffect(() => {
    if (visible) {
      setViewYear(initDate.getFullYear());
      setViewMonth(initDate.getMonth());
      setSelected(initDate);
    }
  }, [visible]);

  if (!visible) return null;

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1); }
    else setViewMonth(m => m-1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1); }
    else setViewMonth(m => m+1);
  };

  const firstDay   = new Date(viewYear, viewMonth, 1).getDay();
  const offset     = (firstDay + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Calcular actividad por día
  const activityMap = {};
  movements.forEach(m => {
    const mp = m.date.split('/');
    if (mp.length !== 3) return;
    const mY = parseInt(mp[2]), mM = parseInt(mp[1])-1, mD = parseInt(mp[0]);
    if (mY === viewYear && mM === viewMonth) {
      if (!activityMap[mD]) activityMap[mD] = { income: 0, expense: 0, total: 0 };
      if (m.type === 'income')  activityMap[mD].income  += parseFloat(m.amount) || 0;
      else                      activityMap[mD].expense += parseFloat(m.amount) || 0;
      activityMap[mD].total += parseFloat(m.amount) || 0;
    }
  });

  // Máximo monto para calcular intensidad heatmap
  const maxAmount = Math.max(...Object.values(activityMap).map(a => a.total), 1);

  const isSelected = (d) =>
    d && selected.getDate() === d && selected.getMonth() === viewMonth && selected.getFullYear() === viewYear;
  const isToday_ = (d) =>
    d && today.getDate() === d && today.getMonth() === viewMonth && today.getFullYear() === viewYear;

  const confirmDate = () => {
    const day = String(selected.getDate()).padStart(2,'0');
    const mon = String(selected.getMonth()+1).padStart(2,'0');
    onConfirm(`${day}/${mon}/${selected.getFullYear()}`);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <TouchableOpacity style={cal.overlay} activeOpacity={1} onPress={onCancel}>
        <View style={cal.card} onStartShouldSetResponder={() => true}>

          <View style={cal.navRow}>
            <TouchableOpacity style={cal.navBtn} onPress={prevMonth}>
              <Text style={cal.navArrow}>‹</Text>
            </TouchableOpacity>
            <Text style={cal.navTitle}>{MONTHS_ES[viewMonth]} {viewYear}</Text>
            <TouchableOpacity style={cal.navBtn} onPress={nextMonth}>
              <Text style={cal.navArrow}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={cal.weekRow}>
            {DAYS_ES.map(d => <Text key={d} style={cal.weekDay}>{d}</Text>)}
          </View>

          <View style={cal.grid}>
            {cells.map((d, i) => {
              const activity = d ? activityMap[d] : null;
              const intensity = activity ? Math.min(activity.total / maxAmount, 1) : 0;
              const heatBg = activity && intensity > 0
                ? `rgba(79,142,247,${0.08 + intensity * 0.22})`
                : undefined;

              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    cal.cell,
                    !d && cal.cellEmpty,
                    isToday_(d) && cal.cellToday,
                    isSelected(d) && cal.cellSelected,
                    heatBg && !isSelected(d) && { backgroundColor: heatBg },
                  ]}
                  onPress={() => d && setSelected(new Date(viewYear, viewMonth, d))}
                  disabled={!d}
                  activeOpacity={d ? 0.7 : 1}
                >
                  <Text style={[
                    cal.cellText,
                    isToday_(d) && cal.cellTextToday,
                    isSelected(d) && cal.cellTextSelected,
                  ]}>
                    {d || ''}
                  </Text>

                  {/* Dots de actividad */}
                  {activity && !isSelected(d) && (
                    <View style={cal.dotsRow}>
                      {activity.income  > 0 && <View style={[cal.dot, { backgroundColor: C.income }]} />}
                      {activity.expense > 0 && <View style={[cal.dot, { backgroundColor: C.expense }]} />}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={cal.actions}>
            <TouchableOpacity style={cal.btnCancel} onPress={onCancel}>
              <Text style={cal.btnCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={cal.btnConfirm} onPress={confirmDate}>
              <Text style={cal.btnConfirmText}>✓ Confirmar</Text>
            </TouchableOpacity>
          </View>

        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const cal = StyleSheet.create({
  overlay:  { flex:1, backgroundColor:'rgba(0,0,0,0.72)', alignItems:'center', justifyContent:'center', paddingHorizontal:20 },
  card:     { backgroundColor:C.surface, borderRadius:20, borderWidth:1, borderColor:C.border, paddingHorizontal:16, paddingVertical:20, width:'100%', maxWidth:340, shadowColor:'#000', shadowOffset:{width:0,height:12}, shadowOpacity:0.5, shadowRadius:20, elevation:16 },
  navRow:   { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:16 },
  navBtn:   { width:36, height:36, borderRadius:18, backgroundColor:C.surface2, borderWidth:1, borderColor:C.border, alignItems:'center', justifyContent:'center' },
  navArrow: { fontSize:22, color:C.accent2, fontWeight:'700', lineHeight:26 },
  navTitle: { fontSize:16, fontWeight:'700', color:C.text, letterSpacing:0.3 },
  weekRow:  { flexDirection:'row', marginBottom:8 },
  weekDay:  { flex:1, textAlign:'center', fontSize:11, fontWeight:'600', color:C.text3, textTransform:'uppercase', letterSpacing:0.5 },
  grid:     { flexDirection:'row', flexWrap:'wrap' },
  cell:     { width:`${100/7}%`, aspectRatio:1, alignItems:'center', justifyContent:'center', borderRadius:99 },
  cellEmpty:{ opacity:0 },
  cellToday:{ borderWidth:2, borderColor:C.accent, shadowColor:C.accent, shadowOffset:{width:0,height:0}, shadowOpacity:0.6, shadowRadius:6, elevation:4 },
  cellSelected: { backgroundColor:C.accent },
  cellText: { fontSize:14, color:C.text2, fontWeight:'400' },
  cellTextToday:    { color:C.accent2, fontWeight:'700' },
  cellTextSelected: { color:'#fff', fontWeight:'700' },
  dotsRow:  { flexDirection:'row', gap:2, position:'absolute', bottom:3 },
  dot:      { width:4, height:4, borderRadius:2 },
  actions:  { flexDirection:'row', gap:10, marginTop:16 },
  btnCancel:  { flex:1, paddingVertical:12, borderRadius:12, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center' },
  btnCancelText:  { fontSize:14, fontWeight:'600', color:C.text2 },
  btnConfirm:     { flex:1, paddingVertical:12, borderRadius:12, backgroundColor:C.accent, alignItems:'center' },
  btnConfirmText: { fontSize:14, fontWeight:'700', color:'#fff' },
});

// ─────────────────────────────────────────
// SWIPEABLE MOVEMENT ROW
// ─────────────────────────────────────────
function SwipeableMovementRow({ item, onDelete, currencySymbol }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const SWIPE_THRESHOLD = -72;

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dy) < 20,
    onPanResponderMove: (_, g) => {
      const x = Math.max(g.dx, -100);
      if (x < 0) translateX.setValue(x);
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < SWIPE_THRESHOLD) {
        Animated.timing(translateX, { toValue: -80, duration: 120, useNativeDriver: true }).start();
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension:80, friction:10 }).start();
      }
    },
  })).current;

  const resetSwipe = () =>
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension:80, friction:10 }).start();

  const isIncome = item.type === 'income';

  return (
    <View style={{ marginBottom: 10, borderRadius: 16, overflow: 'hidden' }}>
      {/* Delete background */}
      <View style={sw.deleteBg}>
        <TouchableOpacity style={sw.deleteBgBtn} onPress={() => onDelete(item.id)}>
          <Text style={sw.deleteBgIcon}>🗑</Text>
          <Text style={sw.deleteBgText}>Eliminar</Text>
        </TouchableOpacity>
      </View>

      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX }] }}>
        <TouchableOpacity activeOpacity={0.85} onPress={resetSwipe}>
          <View style={[s.card, { marginBottom: 0 }, isIncome ? s.cardIncome : s.cardExpense]}>
            <View style={[s.typeIcon, isIncome ? s.typeIconIncome : s.typeIconExpense]}>
              <Text style={[s.typeIconText, { color: isIncome ? C.income : C.expense }]}>
                {isIncome ? '↑' : '↓'}
              </Text>
            </View>
            <View style={s.itemInfo}>
              <Text style={s.itemName} numberOfLines={1}>{item.description}</Text>
              <View style={s.itemMeta}>
                <Text style={[s.amountPrefix, isIncome ? s.amountIncome : s.amountExpense]}>
                  {isIncome ? '+' : '−'} {fmt(item.amount, currencySymbol)}
                </Text>
                <Text style={s.itemDate}>📅 {item.date}</Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const sw = StyleSheet.create({
  deleteBg: {
    position:'absolute', top:0, right:0, bottom:0,
    backgroundColor:'rgba(224,112,112,0.2)',
    borderRadius:16, alignItems:'flex-end', justifyContent:'center',
    borderWidth:1, borderColor:'rgba(224,112,112,0.35)',
  },
  deleteBgBtn: { width:80, alignItems:'center', justifyContent:'center', gap:4, paddingVertical:12 },
  deleteBgIcon: { fontSize:18 },
  deleteBgText: { fontSize:11, color:C.expense, fontWeight:'600' },
});

// ─────────────────────────────────────────
// MOVEMENT ROW (versión editable para estado de cuenta)
// ─────────────────────────────────────────
function MovementRowEditable({ item, onDelete, currencySymbol }) {
  const isIncome = item.type === 'income';
  return (
    <View style={acct.moveRow}>
      <View style={[acct.moveIcon, { backgroundColor: isIncome ? 'rgba(79,207,138,0.12)' : 'rgba(224,112,112,0.12)' }]}>
        <Text style={{ fontSize:14, color: isIncome ? C.income : C.expense, fontWeight:'700' }}>
          {isIncome ? '↑' : '↓'}
        </Text>
      </View>
      <View style={{ flex:1, minWidth:0 }}>
        <Text style={acct.moveName} numberOfLines={1}>{item.description}</Text>
      </View>
      <Text style={[acct.moveAmt, { color: isIncome ? C.income : C.expense }]}>
        {isIncome ? '+' : '−'} {fmt(item.amount, currencySymbol)}
      </Text>
      <TouchableOpacity
        style={acct.moveDelete}
        onPress={() => onDelete(item.id)}
        hitSlop={{ top:8, bottom:8, left:8, right:8 }}
      >
        <Text style={{ fontSize:14, color:C.text3 }}>🗑</Text>
      </TouchableOpacity>
    </View>
  );
}

const acct = StyleSheet.create({
  moveRow:    { flexDirection:'row', alignItems:'center', gap:10, paddingVertical:8 },
  moveIcon:   { width:28, height:28, borderRadius:14, alignItems:'center', justifyContent:'center' },
  moveName:   { fontSize:14, color:C.text, flex:1 },
  moveAmt:    { fontSize:14, fontWeight:'700' },
  moveDelete: { width:28, height:28, alignItems:'center', justifyContent:'center' },
});

// ─────────────────────────────────────────
// MINI BAR CHART
// ─────────────────────────────────────────
function MiniBarChart({ groups, currencySymbol }) {
  if (!groups || groups.length === 0) return null;

  const maxVal = Math.max(...groups.flatMap(g => [
    g.items.filter(m => m.type==='income').reduce((s,m)=>s+m.amount,0),
    g.items.filter(m => m.type==='expense').reduce((s,m)=>s+m.amount,0),
  ]), 1);

  const sliced = groups.slice(0, 10).reverse();

  return (
    <View style={chart.container}>
      <Text style={chart.title}>📊 Ingresos vs Gastos por día</Text>
      <View style={chart.barsArea}>
        {sliced.map(({ date, items }) => {
          const inc = items.filter(m=>m.type==='income').reduce((s,m)=>s+m.amount,0);
          const exp = items.filter(m=>m.type==='expense').reduce((s,m)=>s+m.amount,0);
          const inH = Math.max((inc / maxVal) * 80, inc > 0 ? 4 : 0);
          const exH = Math.max((exp / maxVal) * 80, exp > 0 ? 4 : 0);
          const dp  = date.split('/');
          const label = dp.length === 3 ? `${dp[0]}/${dp[1]}` : date;
          return (
            <View key={date} style={chart.barGroup}>
              <View style={chart.barsWrap}>
                {inc > 0 && <View style={[chart.bar, { height: inH, backgroundColor: C.income }]} />}
                {exp > 0 && <View style={[chart.bar, { height: exH, backgroundColor: C.expense }]} />}
                {inc === 0 && exp === 0 && <View style={[chart.bar, { height: 4, backgroundColor: C.surface3 }]} />}
              </View>
              <Text style={chart.barLabel}>{label}</Text>
            </View>
          );
        })}
      </View>
      <View style={chart.legend}>
        <View style={chart.legendItem}>
          <View style={[chart.legendDot, { backgroundColor: C.income }]} />
          <Text style={chart.legendText}>Ingreso</Text>
        </View>
        <View style={chart.legendItem}>
          <View style={[chart.legendDot, { backgroundColor: C.expense }]} />
          <Text style={chart.legendText}>Gasto</Text>
        </View>
      </View>
    </View>
  );
}

const chart = StyleSheet.create({
  container: { backgroundColor:C.surface2, borderRadius:16, borderWidth:1, borderColor:C.border, padding:16, marginBottom:16 },
  title:     { fontSize:13, fontWeight:'600', color:C.text2, marginBottom:14 },
  barsArea:  { flexDirection:'row', alignItems:'flex-end', gap:6, height:100, marginBottom:8 },
  barGroup:  { flex:1, alignItems:'center', gap:4 },
  barsWrap:  { flexDirection:'row', alignItems:'flex-end', gap:2, flex:1, justifyContent:'center' },
  bar:       { width:10, borderRadius:4 },
  barLabel:  { fontSize:9, color:C.text3, textAlign:'center' },
  legend:    { flexDirection:'row', gap:16, justifyContent:'center', marginTop:4 },
  legendItem:{ flexDirection:'row', alignItems:'center', gap:6 },
  legendDot: { width:8, height:8, borderRadius:4 },
  legendText:{ fontSize:11, color:C.text3 },
});

// ─────────────────────────────────────────
// APP INNER
// ─────────────────────────────────────────
function AppInner() {
  const insets = useSafeAreaInsets();

  // ── Pantallas: 'main' | 'account' ──
  const [currentScreen, setCurrentScreen] = useState('main');

  // ── Listas ──
  const [lists,        setLists]        = useState([]);
  const [activeListId, setActiveListId] = useState(null);

  // ── Formulario ──
  const [description,       setDescription]       = useState('');
  const [amount,            setAmount]            = useState('');
  const [moveType,          setMoveType]          = useState('income');
  const [dateInput,         setDateInput]         = useState(todayStr());
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [formVisible,       setFormVisible]       = useState(true);

  // ── Búsqueda (estado de cuenta) ──
  const [searchQuery, setSearchQuery] = useState('');

  // ── Modales ──
  const [drawerVisible,        setDrawerVisible]        = useState(false);
  const [listSelectorVisible,  setListSelectorVisible]  = useState(false);
  const [budgetModalVisible,   setBudgetModalVisible]   = useState(false);
  const [budgetInput,          setBudgetInput]          = useState('');
  const [pdfModalVisible,      setPdfModalVisible]      = useState(false);
  const [finalizarVisible,     setFinalizarVisible]     = useState(false);
  const [reuseModalVisible,    setReuseModalVisible]    = useState(false);
  const [reuseSession,         setReuseSession]         = useState(null);
  const [clearHistoryModal,    setClearHistoryModal]    = useState(false);
  const [clearListModal,       setClearListModal]       = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [periodModalVisible,   setPeriodModalVisible]   = useState(false);
  const [expandedHistory,      setExpandedHistory]      = useState(null);

  // ── Modal nueva/editar lista ──
  const [newListModal,    setNewListModal]    = useState(false);
  const [editListModal,   setEditListModal]   = useState(false);
  const [editingList,     setEditingList]     = useState(null);
  const [newListName,     setNewListName]     = useState('');
  const [newListColor,    setNewListColor]    = useState(LIST_COLORS[0]);
  const [newListCurrency, setNewListCurrency] = useState(CURRENCIES[0]);
  const [newListPeriod,   setNewListPeriod]   = useState('Mensual');
  const [deleteListModal, setDeleteListModal] = useState(false);
  const [listToDelete,    setListToDelete]    = useState(null);

  // ── Toast ──
  const [toastMsg,     setToastMsg]     = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastAnim = useRef(new Animated.Value(0)).current;

  // ── Animaciones ──
  const drawerAnim    = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const finalizarAnim = useRef(new Animated.Value(0)).current;
  const screenAnim    = useRef(new Animated.Value(0)).current;
  const descInputRef  = useRef(null);
  const editingRef    = useRef(false);

  // ─────────────────────────────────────────
  // LISTA ACTIVA
  // ─────────────────────────────────────────
  const activeList = lists.find(l => l.id === activeListId) || lists[0] || null;

  const updateActiveList = useCallback((updater) => {
    setLists(prev => {
      const updated = prev.map(l =>
        l.id === (activeList?.id) ? { ...l, ...updater(l) } : l
      );
      persist(LISTS_KEY, updated);
      return updated;
    });
  }, [activeList]);

  const updateListById = useCallback((id, updater) => {
    setLists(prev => {
      const updated = prev.map(l => l.id === id ? { ...l, ...updater(l) } : l);
      persist(LISTS_KEY, updated);
      return updated;
    });
  }, []);

  // ─────────────────────────────────────────
  // CARGA INICIAL + MIGRACIÓN
  // ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const savedLists  = await load(LISTS_KEY,  null);
      const savedActive = await load(ACTIVE_KEY, null);

      if (savedLists && savedLists.length > 0) {
        setLists(savedLists);
        setActiveListId(savedActive || savedLists[0].id);
        return;
      }

      const legacyMovements = await load(LEGACY_MOVEMENTS_KEY, []);
      const legacyHistory   = await load(LEGACY_HISTORY_KEY,   []);
      const legacyCurrency  = await load(LEGACY_CURRENCY_KEY,  CURRENCIES[0]);
      const legacyPeriod    = await load(LEGACY_PERIOD_KEY,    'Mensual');
      const legacyBudget    = await load(LEGACY_BUDGET_KEY,    0);

      const ml = createList({ name:'Mi presupuesto', color:LIST_COLORS[0], currency:legacyCurrency, period:legacyPeriod });
      ml.movements = legacyMovements;
      ml.history   = legacyHistory;
      ml.budget    = legacyBudget;

      const initialLists = [ml];
      setLists(initialLists);
      setActiveListId(ml.id);
      await persist(LISTS_KEY,  initialLists);
      await persist(ACTIVE_KEY, ml.id);
    })();
  }, []);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      editingRef.current = false;
      setFormVisible(true);
    });
    return () => sub.remove();
  }, []);

  // ─────────────────────────────────────────
  // TOAST
  // ─────────────────────────────────────────
  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    setToastVisible(true);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue:1, duration:280, useNativeDriver:true }),
      Animated.delay(2200),
      Animated.timing(toastAnim, { toValue:0, duration:280, useNativeDriver:true }),
    ]).start(() => setToastVisible(false));
  }, [toastAnim]);

  // ─────────────────────────────────────────
  // NAVEGACIÓN PANTALLAS
  // ─────────────────────────────────────────
  const goToScreen = (screen) => {
    setCurrentScreen(screen);
    Animated.timing(screenAnim, { toValue:0, duration:0, useNativeDriver:true }).start();
    Animated.spring(screenAnim, { toValue:1, useNativeDriver:true, tension:70, friction:12 }).start();
    setSearchQuery('');
  };

  const goBack = () => {
    setCurrentScreen('main');
    setSearchQuery('');
  };

  // ─────────────────────────────────────────
  // DRAWER
  // ─────────────────────────────────────────
  const openDrawer = () => {
    setDrawerVisible(true);
    Animated.spring(drawerAnim, { toValue:0, useNativeDriver:true, tension:60, friction:11 }).start();
  };
  const closeDrawer = (onDone) => {
    Animated.timing(drawerAnim, { toValue:-DRAWER_WIDTH, duration:240, useNativeDriver:true })
      .start(() => { setDrawerVisible(false); if (onDone) onDone(); });
  };

  // ─────────────────────────────────────────
  // MODAL FINALIZAR
  // ─────────────────────────────────────────
  const openFinalizarModal = () => {
    setFinalizarVisible(true);
    Animated.spring(finalizarAnim, { toValue:1, useNativeDriver:true, tension:70, friction:10 }).start();
  };
  const closeFinalizarModal = () => {
    Animated.spring(finalizarAnim, { toValue:0, useNativeDriver:true, tension:70, friction:10 })
      .start(() => setFinalizarVisible(false));
  };

  // ─────────────────────────────────────────
  // CÁLCULOS
  // ─────────────────────────────────────────
  const movements = activeList?.movements || [];
  const period    = activeList?.period    || 'Mensual';
  const currency  = activeList?.currency  || CURRENCIES[0];
  const budget    = activeList?.budget    || 0;
  const history   = activeList?.history   || [];

  // Movimientos del período
  const filteredByPeriod = movements.filter(m => isInPeriod(m.date, period));

  // Movimientos de hoy (para pantalla principal)
  const todayMovements = movements.filter(m => isToday(m.date));

  const totalIngreso = filteredByPeriod.filter(m=>m.type==='income').reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
  const totalGasto   = filteredByPeriod.filter(m=>m.type==='expense').reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
  const totalBalance = totalIngreso - totalGasto;

  const budgetUsed   = budget > 0 ? Math.min(totalGasto/budget,1) : 0;
  const budgetRemain = budget > 0 ? budget - totalGasto : 0;
  const budgetOver   = budget > 0 && totalGasto > budget;
  const budgetWarn   = budget > 0 && budgetUsed > 0.85 && !budgetOver;

  // Estado de cuenta agrupado por día
  const accountGroups = (() => {
    let filtered = filteredByPeriod;
    if (searchQuery.trim()) {
      filtered = filtered.filter(m =>
        m.description.toLowerCase().includes(searchQuery.trim().toLowerCase())
      );
    }
    return groupByDate(filtered);
  })();

  // Badge: total movimientos del período
  const periodMovementsCount = filteredByPeriod.length;

  // ─────────────────────────────────────────
  // CRUD MOVIMIENTOS
  // ─────────────────────────────────────────
  const addMovement = () => {
    if (!activeList) return;
    const desc = description.trim();
    if (!desc) { showToast('Ingresá la descripción del movimiento'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { showToast('Ingresá un monto válido'); return; }

    const newMove = {
      id:          Date.now().toString(),
      description: desc,
      amount:      amt,
      type:        moveType,
      date:        dateInput || todayStr(),
    };
    updateActiveList(l => ({ movements: [newMove, ...l.movements] }));
    setDescription('');
    setAmount('');
    setDateInput(todayStr());
    Keyboard.dismiss();
    showToast(moveType==='income' ? 'Ingreso registrado ✓' : 'Gasto registrado ✓');
  };

  const deleteMovement = (id) =>
    updateActiveList(l => ({ movements: l.movements.filter(m => m.id !== id) }));

  const clearAll = () => {
    if (!movements.length) { showToast('No hay movimientos registrados'); return; }
    setClearListModal(true);
  };

  // ─────────────────────────────────────────
  // PRESUPUESTO / PERÍODO / MONEDA
  // ─────────────────────────────────────────
  const saveBudget = () => {
    const val = parseFloat(budgetInput.replace(/[^\d.]/g,'')) || 0;
    updateActiveList(() => ({ budget: val }));
    setBudgetModalVisible(false);
    showToast(val > 0 ? `Presupuesto: ${fmt(val, currency.symbol)} ✓` : 'Presupuesto desactivado');
  };

  const selectPeriod = (per) => {
    updateActiveList(() => ({ period: per }));
    setPeriodModalVisible(false);
    showToast(`Período: ${per} ✓`);
  };

  const selectCurrency = (cur) => {
    updateActiveList(() => ({ currency: cur }));
    setCurrencyModalVisible(false);
    showToast(`Moneda: ${cur.symbol} ${cur.label} ✓`);
  };

  // ─────────────────────────────────────────
  // GESTIÓN DE LISTAS
  // ─────────────────────────────────────────
  const switchList = async (id) => {
    setActiveListId(id);
    await persist(ACTIVE_KEY, id);
    setListSelectorVisible(false);
    setSearchQuery('');
  };

  const openNewListModal = () => {
    const usedColors = lists.map(l => l.color);
    const freeColor  = LIST_COLORS.find(c => !usedColors.includes(c)) || LIST_COLORS[lists.length % LIST_COLORS.length];
    setNewListName('');
    setNewListColor(freeColor);
    setNewListCurrency(CURRENCIES[0]);
    setNewListPeriod('Mensual');
    setNewListModal(true);
  };

  const confirmNewList = async () => {
    const name = newListName.trim();
    if (!name) { showToast('Ponele un nombre al presupuesto'); return; }
    if (lists.length >= MAX_LISTS) { showToast(`Máximo ${MAX_LISTS} presupuestos`); return; }
    const newList = createList({ name, color:newListColor, currency:newListCurrency, period:newListPeriod });
    const updated = [...lists, newList];
    setLists(updated);
    await persist(LISTS_KEY, updated);
    setActiveListId(newList.id);
    await persist(ACTIVE_KEY, newList.id);
    setNewListModal(false);
    setListSelectorVisible(false);
    showToast(`"${name}" creado ✓`);
  };

  const openEditList = (list) => {
    setEditingList(list);
    setNewListName(list.name);
    setNewListColor(list.color);
    setEditListModal(true);
  };

  const confirmEditList = async () => {
    const name = newListName.trim();
    if (!name) { showToast('El nombre no puede estar vacío'); return; }
    updateListById(editingList.id, () => ({ name, color:newListColor }));
    setEditListModal(false);
    showToast('Presupuesto actualizado ✓');
  };

  const confirmDeleteList = async () => {
    if (!listToDelete) return;
    const updated = lists.filter(l => l.id !== listToDelete.id);
    setLists(updated);
    await persist(LISTS_KEY, updated);
    if (activeListId === listToDelete.id) {
      const next = updated[0]?.id || null;
      setActiveListId(next);
      await persist(ACTIVE_KEY, next);
    }
    setDeleteListModal(false);
    setListToDelete(null);
    showToast('Presupuesto eliminado 🗑');
  };

  // ─────────────────────────────────────────
  // FINALIZAR PERÍODO
  // ─────────────────────────────────────────
  const finalizarPeriodo = () => {
    if (!filteredByPeriod.length) { showToast('No hay movimientos en el período'); return; }
    openFinalizarModal();
  };

  const confirmarFinalizar = async () => {
    const session = {
      id:        Date.now().toString(),
      period,
      date:      new Date().toLocaleDateString(getLocale(), { day:'2-digit', month:'long', year:'numeric' }),
      time:      new Date().toLocaleTimeString(getLocale(), { hour:'2-digit', minute:'2-digit' }),
      ingreso:   totalIngreso,
      gasto:     totalGasto,
      balance:   totalBalance,
      currency:  currency.symbol,
      movements: [...filteredByPeriod],
    };
    updateActiveList(l => ({
      history:   [session, ...l.history].slice(0,30),
      movements: l.movements.filter(m => !isInPeriod(m.date, l.period)),
    }));
    closeFinalizarModal();
    showToast('Período guardado en historial ✓');
  };

  // ─────────────────────────────────────────
  // RESTAURAR DESDE HISTORIAL
  // ─────────────────────────────────────────
  const restoreFromHistory = (session) => {
    setReuseSession(session);
    setReuseModalVisible(true);
  };

  const confirmRestoreFromHistory = () => {
    if (!reuseSession) return;
    const cloned = reuseSession.movements.map(m => ({
      ...m,
      id:   Date.now().toString() + Math.random().toString(36).slice(2),
      date: todayStr(),
    }));
    updateActiveList(l => ({ movements: [...cloned, ...l.movements] }));
    const date = reuseSession.date;
    setReuseModalVisible(false);
    setReuseSession(null);
    closeDrawer(() => showToast(`Movimientos del ${date} cargados ✓`));
  };

  // ─────────────────────────────────────────
  // PDF
  // ─────────────────────────────────────────
  const downloadPDF = async () => {
    setPdfModalVisible(false);
    const date = new Date().toLocaleDateString(getLocale(), { day:'2-digit', month:'long', year:'numeric' });

    const rows = filteredByPeriod.map(m => {
      const isInc = m.type === 'income';
      return `<tr>
        <td>${m.description}</td>
        <td style="text-align:center">${isInc ? 'Ingreso' : 'Gasto'}</td>
        <td style="text-align:right;color:${isInc ? '#2a9d5c' : '#c0392b'}">${isInc ? '+' : '−'} ${currency.symbol} ${Math.round(m.amount).toLocaleString(getLocale())}</td>
        <td>${m.date}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: Georgia,serif; margin:40px; color:#111; }
  h1   { font-size:28px; margin-bottom:4px; color:#1a2e5a; }
  .sub { color:#666; font-size:14px; margin-bottom:24px; }
  table { width:100%; border-collapse:collapse; }
  th { background:#1a2e5a; color:#fff; padding:10px 12px; text-align:left; font-size:13px; }
  td { padding:10px 12px; border-bottom:1px solid #eee; font-size:14px; }
  .total-row td { font-weight:bold; font-size:15px; border-top:2px solid #1a2e5a; padding-top:14px; }
  .income { color:#2a9d5c; } .expense { color:#c0392b; }
  .balance-pos { color:#2a9d5c; font-size:18px; }
  .balance-neg { color:#c0392b; font-size:18px; }
</style></head><body>
<h1>💰 ${activeList?.name || 'Mis Finanzas'}</h1>
<div class="sub">${date} · Período: ${period} · Moneda: ${currency.symbol} ${currency.label}</div>
<table><thead><tr><th>Descripción</th><th>Tipo</th><th>Monto</th><th>Fecha</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot>
  <tr class="total-row"><td colspan="2">TOTAL INGRESOS</td><td class="income">+ ${currency.symbol} ${Math.round(totalIngreso).toLocaleString(getLocale())}</td><td></td></tr>
  <tr class="total-row"><td colspan="2">TOTAL GASTOS</td><td class="expense">− ${currency.symbol} ${Math.round(totalGasto).toLocaleString(getLocale())}</td><td></td></tr>
  <tr class="total-row"><td colspan="2">BALANCE</td><td class="${totalBalance>=0?'balance-pos':'balance-neg'}">${totalBalance>=0?'+':'−'} ${currency.symbol} ${Math.abs(Math.round(totalBalance)).toLocaleString(getLocale())}</td><td></td></tr>
</tfoot></table></body></html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html });
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri, { mimeType:'application/pdf', dialogTitle:'Compartir reporte', UTI:'com.adobe.pdf' });
      } else { showToast('Compartir no disponible en este dispositivo'); }
    } catch (err) { showToast('Error al generar el PDF'); }
  };

  // ─────────────────────────────────────────
  // CSV
  // ─────────────────────────────────────────
  const downloadCSV = async () => {
    setPdfModalVisible(false);
    if (!filteredByPeriod.length) { showToast('No hay movimientos para exportar'); return; }
    try {
      const sym    = currency.symbol;
      const BOM    = '\uFEFF';
      const header = 'Descripcion,Tipo,Monto,Moneda,Fecha\n';
      const rows   = filteredByPeriod.map(m =>
        `"${m.description.replace(/"/g,'""')}","${m.type==='income'?'Ingreso':'Gasto'}",${m.amount},"${sym}","${m.date}"`
      ).join('\n');
      const totals =
        `\n"TOTAL INGRESOS","",${totalIngreso},"${sym}",""\n` +
        `"TOTAL GASTOS","",${totalGasto},"${sym}",""\n` +
        `"BALANCE","",${totalBalance},"${sym}",""`;
      const csv     = BOM + header + rows + totals;
      const fileName= `mis-finanzas-${(activeList?.name||'lista').replace(/\s+/g,'-').toLowerCase()}-${Date.now()}.csv`;
      const fileUri = FileSystem.cacheDirectory + fileName;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding:FileSystem.EncodingType.UTF8 });
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(fileUri, { mimeType:'text/csv', dialogTitle:'Guardar o compartir Excel', UTI:'public.comma-separated-values-text' });
      } else { showToast('Compartir no disponible en este dispositivo'); }
    } catch (err) { showToast('Error al exportar el archivo'); }
  };

  // ─────────────────────────────────────────
  // COMPARTIR
  // ─────────────────────────────────────────
  const shareList = async () => {
    if (!filteredByPeriod.length) { showToast('No hay movimientos para compartir'); return; }
    const sym  = currency.symbol;
    const text =
      `💰 *${activeList?.name || 'Mis Finanzas'} — ${period}*\n\n` +
      filteredByPeriod.map(m =>
        `${m.type==='income'?'↑ ':'↓ '}${m.description} · ${m.type==='income'?'+':'−'} ${fmt(m.amount,sym)} · ${m.date}`
      ).join('\n') +
      `\n\n*Ingreso: ${fmt(totalIngreso,sym)}*\n*Gasto: ${fmt(totalGasto,sym)}*\n*Balance: ${totalBalance>=0?'+':'−'} ${fmt(Math.abs(totalBalance),sym)}*`;
    try { await Share.share({ message: text }); }
    catch { showToast('No se pudo compartir'); }
  };

  // ─────────────────────────────────────────
  // RENDER HISTORIAL
  // ─────────────────────────────────────────
  const renderHistoryItem = (session) => {
    const isExpanded = expandedHistory === session.id;
    const sym        = session.currency || currency.symbol;
    return (
      <View key={session.id} style={s.historyCard}>
        <TouchableOpacity
          style={s.historyHeader}
          onPress={() => restoreFromHistory(session)}
          onLongPress={() => setExpandedHistory(isExpanded ? null : session.id)}
          delayLongPress={400}
        >
          <View style={{ flex:1 }}>
            <Text style={s.historyDate}>{session.date}</Text>
            <Text style={s.historyTime}>{session.time} · {session.period} · {session.movements.length} movimientos</Text>
            <Text style={s.historyRestoreHint}>Tocá para reutilizar · mantené para ver detalle</Text>
          </View>
          <View style={{ alignItems:'flex-end' }}>
            <Text style={[s.historyBalance, { color: session.balance>=0?C.income:C.expense }]}>
              {session.balance>=0?'+':'−'} {fmt(Math.abs(session.balance),sym)}
            </Text>
            <View style={s.historyRestoreTag}>
              <Text style={s.historyRestoreTagText}>↩ reutilizar</Text>
            </View>
          </View>
        </TouchableOpacity>

        {isExpanded && (
          <View style={s.historyItems}>
            {session.movements.map((m,idx) => (
              <View key={idx} style={s.historyRow}>
                <Text style={[s.historyItemName, { color: m.type==='income'?C.income:C.expense }]} numberOfLines={1}>
                  {m.type==='income'?'↑ ':'↓ '}{m.description}
                </Text>
                <Text style={[s.historyItemPrice, { color: m.type==='income'?C.income:C.expense }]}>
                  {m.type==='income'?'+':'−'} {fmt(m.amount,sym)}
                </Text>
              </View>
            ))}
            <View style={s.historyTotalRow}><Text style={s.historyTotalLabel}>Ingreso</Text><Text style={[s.historyTotalVal,{color:C.income}]}>+ {fmt(session.ingreso,sym)}</Text></View>
            <View style={s.historyTotalRow}><Text style={s.historyTotalLabel}>Gasto</Text><Text style={[s.historyTotalVal,{color:C.expense}]}>− {fmt(session.gasto,sym)}</Text></View>
            <View style={s.historyTotalRow}>
              <Text style={s.historyTotalLabel}>Balance</Text>
              <Text style={[s.historyTotalVal,{color:session.balance>=0?C.income:C.expense}]}>
                {session.balance>=0?'+':'−'} {fmt(Math.abs(session.balance),sym)}
              </Text>
            </View>
            <TouchableOpacity style={s.historyRestoreBtn} onPress={() => restoreFromHistory(session)}>
              <Text style={s.historyRestoreBtnText}>↩ Reutilizar movimientos</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const BOTTOM_BAR_HEIGHT = 56 + Math.max(12, insets.bottom);

  // ══════════════════════════════════════════════════
  //  PANTALLA: ESTADO DE CUENTA
  // ══════════════════════════════════════════════════
  if (currentScreen === 'account') {
    const periodIncome = filteredByPeriod.filter(m=>m.type==='income').reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
    const periodExpense= filteredByPeriod.filter(m=>m.type==='expense').reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
    const periodBal    = periodIncome - periodExpense;

    return (
      <SafeAreaView style={s.safeArea} edges={['top','left','right']}>
        <StatusBar barStyle="light-content" backgroundColor={C.surface} />

        {toastVisible && (
          <Animated.View style={[s.toast, {
            top: insets.top + 12,
            opacity: toastAnim,
            transform: [{ translateY: toastAnim.interpolate({ inputRange:[0,1], outputRange:[-16,0] }) }],
          }]}>
            <Text style={s.toastText}>{toastMsg}</Text>
          </Animated.View>
        )}

        {/* Header cuenta */}
        <View style={[s.header, { paddingBottom: 12 }]}>
          <View style={s.headerTop}>
            <TouchableOpacity
              style={s.btnHamburger}
              onPress={goBack}
              hitSlop={{ top:8,bottom:8,left:8,right:8 }}
            >
              <Text style={{ fontSize:18, color:C.accent2, fontWeight:'700' }}>←</Text>
            </TouchableOpacity>

            <View style={{ flex:1, paddingHorizontal:12 }}>
              <Text style={{ fontSize:16, fontWeight:'700', color:C.text }} numberOfLines={1}>
                Estado de cuenta
              </Text>
              <Text style={{ fontSize:12, color:C.text3, marginTop:1 }}>
                {activeList?.name} · {period}
              </Text>
            </View>

            <TouchableOpacity
              style={s.btnIcon}
              onPress={() => setPdfModalVisible(true)}
              hitSlop={{ top:8,bottom:8,left:8,right:8 }}
            >
              <Text style={{ fontSize:13 }}>📄</Text>
            </TouchableOpacity>
          </View>

          {/* Totales del período */}
          <View style={[s.totalsRow, { marginTop: 10 }]}>
            <View style={[s.totalCard, s.totalCardIncome]}>
              <Text style={s.totalLabel}>Ingreso</Text>
              <Text style={[s.totalAmount, { color:C.income }]}>{fmt(periodIncome, currency.symbol)}</Text>
            </View>
            <View style={[s.totalCard, s.totalCardExpense]}>
              <Text style={s.totalLabel}>Gasto</Text>
              <Text style={[s.totalAmount, { color:C.expense }]}>{fmt(periodExpense, currency.symbol)}</Text>
            </View>
            <View style={[s.totalCard, s.totalCardBalance]}>
              <Text style={s.totalLabel}>Balance</Text>
              <Text style={[s.totalAmount, { color: periodBal>=0?C.income:C.expense }]}>
                {periodBal>=0?'+':'−'}{fmt(Math.abs(periodBal), currency.symbol)}
              </Text>
            </View>
          </View>
        </View>

        {/* Búsqueda */}
        <View style={s.searchSection}>
          <View style={s.searchWrap}>
            <Text style={s.searchIcon}>🔍</Text>
            <TextInput
              style={s.searchInput}
              placeholder="Buscar movimientos..."
              placeholderTextColor={C.text3}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity style={s.searchClear} onPress={() => setSearchQuery('')}>
                <Text style={s.searchClearText}>×</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView
          style={{ flex:1 }}
          contentContainerStyle={{ padding:14, paddingBottom: BOTTOM_BAR_HEIGHT + 10 }}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => Keyboard.dismiss()}
        >
          {/* Gráfica */}
          {accountGroups.length > 0 && (
            <MiniBarChart groups={accountGroups} currencySymbol={currency.symbol} />
          )}

          {accountGroups.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>{searchQuery ? '🔍' : '📭'}</Text>
              <Text style={s.emptyText}>
                {searchQuery ? `Sin resultados para "${searchQuery}"` : 'Sin movimientos en este período'}
              </Text>
            </View>
          ) : (
            accountGroups.map(({ date, items }) => {
              const dayIncome  = items.filter(m=>m.type==='income').reduce((s,m)=>s+m.amount,0);
              const dayExpense = items.filter(m=>m.type==='expense').reduce((s,m)=>s+m.amount,0);
              const dayBal     = dayIncome - dayExpense;
              const isFuture   = parseDateStr(date) > new Date(new Date().setHours(23,59,59,999));
              const isDayToday = isToday(date);

              return (
                <View key={date} style={[
                  acctSection.container,
                  isDayToday && acctSection.containerToday,
                  isFuture   && acctSection.containerFuture,
                ]}>
                  {/* Cabecera del día */}
                  <View style={acctSection.dayHeader}>
                    <View style={{ flex:1 }}>
                      <Text style={[acctSection.dayTitle, isDayToday && { color:C.accent2 }]}>
                        {isDayToday ? '📍 Hoy — ' : ''}{formatDateFull(date)}
                        {isFuture ? '  📅 Programado' : ''}
                      </Text>
                    </View>
                    <Text style={[acctSection.dayBalance, { color: dayBal>=0?C.income:C.expense }]}>
                      {dayBal>=0?'+':'−'}{fmt(Math.abs(dayBal), currency.symbol)}
                    </Text>
                  </View>

                  {/* Separador */}
                  <View style={acctSection.divider} />

                  {/* Movimientos del día */}
                  {items.map(item => (
                    <MovementRowEditable
                      key={item.id}
                      item={item}
                      onDelete={deleteMovement}
                      currencySymbol={currency.symbol}
                    />
                  ))}

                  {/* Sub-totales del día si hay ambos */}
                  {dayIncome > 0 && dayExpense > 0 && (
                    <View style={acctSection.dayTotals}>
                      <Text style={[acctSection.dayTotalText, { color:C.income }]}>+{fmt(dayIncome,currency.symbol)}</Text>
                      <Text style={[acctSection.dayTotalText, { color:C.expense }]}>−{fmt(dayExpense,currency.symbol)}</Text>
                    </View>
                  )}
                </View>
              );
            })
          )}

          {/* Total del período al final */}
          {accountGroups.length > 0 && (
            <View style={acctSection.periodTotal}>
              <Text style={acctSection.periodTotalLabel}>
                Total {period} · {filteredByPeriod.length} movimientos
              </Text>
              <Text style={[acctSection.periodTotalValue, { color: periodBal>=0?C.income:C.expense }]}>
                {periodBal>=0?'+':'−'} {fmt(Math.abs(periodBal), currency.symbol)}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Bottom bar de estado de cuenta */}
        <View style={[s.bottomBar, {
          position:'absolute', bottom:0, left:0, right:0,
          paddingBottom: Math.max(12, insets.bottom),
        }]}>
          <TouchableOpacity style={s.btnBottom} onPress={() => setPdfModalVisible(true)}>
            <Text style={s.btnBottomText}>📄 PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btnBottom, s.btnPrimary]} onPress={shareList}>
            <Text style={[s.btnBottomText, { color:C.bg }]}>↗ Compartir</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnBottom} onPress={downloadCSV}>
            <Text style={s.btnBottomText}>📊 CSV</Text>
          </TouchableOpacity>
        </View>

        {/* Modal PDF/CSV */}
        <Modal visible={pdfModalVisible} transparent animationType="slide" onRequestClose={() => setPdfModalVisible(false)}>
          <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setPdfModalVisible(false)}>
            <View style={[s.modalSheet, { paddingBottom: Math.max(40, insets.bottom+20) }]}>
              <View style={s.sheetHandle} />
              <Text style={s.sheetTitle}>Exportar reporte</Text>
              <Text style={s.sheetSub}>{activeList?.name} · {period} · {filteredByPeriod.length} movimientos</Text>
              <TouchableOpacity style={s.pdfOption} onPress={downloadPDF}>
                <Text style={s.pdfOptionIcon}>📄</Text>
                <View><Text style={s.pdfOptionTitle}>Descargar PDF</Text><Text style={s.pdfOptionSub}>Reporte con ingresos, gastos y balance</Text></View>
              </TouchableOpacity>
              <TouchableOpacity style={s.pdfOption} onPress={downloadCSV}>
                <Text style={s.pdfOptionIcon}>📊</Text>
                <View><Text style={s.pdfOptionTitle}>Descargar CSV</Text><Text style={s.pdfOptionSub}>Compatible con Excel y Google Sheets</Text></View>
              </TouchableOpacity>
              <TouchableOpacity style={s.pdfOption} onPress={() => { setPdfModalVisible(false); shareList(); }}>
                <Text style={s.pdfOptionIcon}>↗</Text>
                <View><Text style={s.pdfOptionTitle}>Compartir como texto</Text><Text style={s.pdfOptionSub}>Para WhatsApp, Telegram, etc.</Text></View>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════
  //  PANTALLA: MAIN
  // ══════════════════════════════════════════════════
  return (
    <SafeAreaView style={s.safeArea} edges={['top','left','right']}>
      <StatusBar barStyle="light-content" backgroundColor={C.surface} />

      {/* Toast */}
      {toastVisible && (
        <Animated.View style={[s.toast, {
          top: insets.top + 12,
          opacity: toastAnim,
          transform: [{ translateY: toastAnim.interpolate({ inputRange:[0,1], outputRange:[-16,0] }) }],
        }]}>
          <Text style={s.toastText}>{toastMsg}</Text>
        </Animated.View>
      )}

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* ══ HEADER ══ */}
        <View style={s.header}>
          <View style={s.headerTop}>
            <TouchableOpacity style={s.btnHamburger} onPress={openDrawer} hitSlop={{top:8,bottom:8,left:8,right:8}}>
              <View style={s.hamburgerLine} />
              <View style={s.hamburgerLine} />
              <View style={s.hamburgerLine} />
            </TouchableOpacity>

            <TouchableOpacity style={s.listSelector} onPress={() => setListSelectorVisible(true)}>
              <View style={[s.listDot, { backgroundColor: activeList?.color || C.accent }]} />
              <Text style={s.listSelectorName} numberOfLines={1}>{activeList?.name || 'Mi presupuesto'}</Text>
              <Text style={s.listSelectorChevron}>▾</Text>
            </TouchableOpacity>

            <View style={s.headerActions}>
              <TouchableOpacity style={s.btnCurrency} onPress={() => setCurrencyModalVisible(true)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                <Text style={s.btnCurrencyText}>{currency.symbol}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnIcon} onPress={clearAll} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                <Text style={s.btnIconText}>🗑</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.periodSelectorRow}>
            <TouchableOpacity style={s.periodSelectorBtn} onPress={() => setPeriodModalVisible(true)}>
              <Text style={s.periodSelectorText}>{period}</Text>
              <Text style={s.periodSelectorChevron}>▾</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.btnBudgetConfig}
              onPress={() => { setBudgetInput(budget > 0 ? String(budget) : ''); setBudgetModalVisible(true); }}
            >
              <Text style={s.btnBudgetConfigText}>
                {budget > 0 ? `💰 ${fmt(budget, currency.symbol)}` : '💰 Presupuesto'}
              </Text>
            </TouchableOpacity>
          </View>

          {budget > 0 && (
            <TouchableOpacity style={s.budgetBar} onPress={() => { setBudgetInput(String(budget)); setBudgetModalVisible(true); }}>
              <View style={s.budgetTrack}>
                <View style={[s.budgetFill, { width:`${Math.round(budgetUsed*100)}%` }, budgetOver&&{backgroundColor:C.expense}, budgetWarn&&{backgroundColor:C.warning}]} />
              </View>
              <Text style={[s.budgetText, budgetOver&&{color:C.expense}, budgetWarn&&{color:C.warning}]}>
                {budgetOver
                  ? `⚠ Excedido por ${fmt(Math.abs(budgetRemain),currency.symbol)}`
                  : `${fmt(budgetRemain,currency.symbol)} disponibles de ${fmt(budget,currency.symbol)}`}
              </Text>
            </TouchableOpacity>
          )}

          <View style={s.totalsRow}>
            <View style={[s.totalCard, s.totalCardIncome]}>
              <Text style={s.totalLabel}>Ingreso</Text>
              <Text style={[s.totalAmount, { color:C.income }]}>{fmt(totalIngreso, currency.symbol)}</Text>
            </View>
            <View style={[s.totalCard, s.totalCardExpense]}>
              <Text style={s.totalLabel}>Gasto</Text>
              <Text style={[s.totalAmount, { color:C.expense }]}>{fmt(totalGasto, currency.symbol)}</Text>
            </View>
            <View style={[s.totalCard, s.totalCardBalance]}>
              <Text style={s.totalLabel}>Balance</Text>
              <Text style={[s.totalAmount, { color: totalBalance>=0?C.income:C.expense }]}>
                {totalBalance>=0?'+':'−'}{fmt(Math.abs(totalBalance), currency.symbol)}
              </Text>
            </View>
          </View>
        </View>

        {/* ══ FORMULARIO ══ */}
        <View style={s.addSection}>
          {formVisible && (
            <>
              <Text style={s.fieldLabel}>Descripción</Text>
              <View style={s.descRow}>
                <TextInput
                  ref={descInputRef}
                  style={[s.input, { flex:1 }]}
                  placeholder="Ej: Salario, Supermercado..."
                  placeholderTextColor={C.text3}
                  value={description}
                  onChangeText={setDescription}
                  onSubmitEditing={addMovement}
                  returnKeyType="done"
                  blurOnSubmit={false}
                />
              </View>

              <View style={s.toggleRow}>
                <TouchableOpacity
                  style={[s.toggleBtn, moveType==='income' && s.toggleBtnIncomeActive]}
                  onPress={() => setMoveType('income')}
                >
                  <Text style={[s.toggleBtnText, moveType==='income' && s.toggleBtnTextActiveIncome]}>Ingreso</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.toggleBtn, moveType==='expense' && s.toggleBtnExpenseActive]}
                  onPress={() => setMoveType('expense')}
                >
                  <Text style={[s.toggleBtnText, moveType==='expense' && s.toggleBtnTextActiveExpense]}>Gasto</Text>
                </TouchableOpacity>
              </View>

              <View style={s.inputGroup}>
                <View style={s.fieldWrap}>
                  <Text style={s.fieldLabel}>Monto ({currency.symbol})</Text>
                  <TextInput
                    style={s.input}
                    placeholder="0"
                    placeholderTextColor={C.text3}
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="numeric"
                    onSubmitEditing={addMovement}
                    returnKeyType="done"
                    onFocus={e => e.target.setNativeProps({ selection:{ start:0, end:amount.length } })}
                  />
                </View>
                <View style={s.fieldWrap}>
                  <Text style={s.fieldLabel}>Fecha</Text>
                  <TouchableOpacity
                    style={[s.input, { justifyContent:'center' }]}
                    onPress={() => { Keyboard.dismiss(); setDatePickerVisible(true); }}
                  >
                    <Text style={{ color:C.text, fontSize:15 }}>📅 {dateInput || todayStr()}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={[s.btnAdd, { backgroundColor: moveType==='income'?C.income:C.expense }]}
                onPress={addMovement}
              >
                <Text style={s.btnAddText}>
                  {moveType==='income' ? '+ Agregar ingreso' : '− Agregar gasto'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={s.btnToggleForm}
            onPress={() => { setFormVisible(v=>!v); if (!formVisible) setTimeout(() => descInputRef.current?.focus(), 120); }}
          >
            <Text style={s.btnToggleFormText}>
              {formVisible ? '▲ Ocultar formulario ▲' : '▼ Agregar movimiento ▼'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ══ MOVIMIENTOS DEL DÍA ══ */}
        <View style={todaySection.header}>
          <Text style={todaySection.title}>
            {todayMovements.length > 0 ? '📋 Movimientos del día' : ''}
          </Text>
        </View>

        <FlatList
          style={s.list}
          data={todayMovements}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <SwipeableMovementRow
              item={item}
              onDelete={deleteMovement}
              currencySymbol={currency.symbol}
            />
          )}
          contentContainerStyle={[s.listContent, { paddingBottom: BOTTOM_BAR_HEIGHT }]}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => { Keyboard.dismiss(); editingRef.current = false; setFormVisible(false); }}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>💸</Text>
              <Text style={s.emptyText}>Sin movimientos hoy</Text>
              <Text style={s.emptySmall}>Registrá ingresos y gastos arriba</Text>
            </View>
          }
        />
      </KeyboardAvoidingView>

      {/* ══ BOTTOM BAR ══ */}
      <View style={[s.bottomBar, {
        position:'absolute', bottom:0, left:0, right:0,
        paddingBottom: Math.max(12, insets.bottom),
      }]}>
        <TouchableOpacity
          style={[s.btnBottom, s.btnPrimary]}
          onPress={finalizarPeriodo}
        >
          <Text style={[s.btnBottomText, { color:C.bg }]}>
            ✓ Finalizar {periodLabel(period)}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ══════════════════════════════════════
          MODAL SELECTOR DE LISTA
      ══════════════════════════════════════ */}
      <Modal visible={listSelectorVisible} transparent animationType="slide" onRequestClose={() => setListSelectorVisible(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setListSelectorVisible(false)}>
          <View style={[s.modalSheet, { paddingBottom: Math.max(40, insets.bottom+20) }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Mis presupuestos</Text>
            <Text style={s.sheetSub}>Seleccioná o creá uno nuevo</Text>
            {lists.map(list => (
              <TouchableOpacity key={list.id} style={[s.listItem, list.id===activeListId&&{borderColor:list.color}]} onPress={() => switchList(list.id)}>
                <View style={[s.listItemDot, { backgroundColor:list.color }]} />
                <View style={{ flex:1 }}>
                  <Text style={s.listItemName}>{list.name}</Text>
                  <Text style={s.listItemSub}>{list.currency.symbol} · {list.period}{list.budget>0?` · ${fmt(list.budget,list.currency.symbol)}`:''}</Text>
                </View>
                <View style={s.listItemActions}>
                  {list.id===activeListId && <Text style={[s.listItemCheck,{color:list.color}]}>✓</Text>}
                  <TouchableOpacity style={s.listItemEditBtn} onPress={() => { setListSelectorVisible(false); openEditList(list); }} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                    <Text style={s.listItemEditText}>✎</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))}
            {lists.length < MAX_LISTS && (
              <TouchableOpacity style={s.btnNewList} onPress={openNewListModal}>
                <Text style={s.btnNewListText}>+ Nuevo presupuesto</Text>
              </TouchableOpacity>
            )}
            {lists.length >= MAX_LISTS && <Text style={s.maxListsNote}>Máximo {MAX_LISTS} presupuestos alcanzado</Text>}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ MODAL NUEVA LISTA ══ */}
      <Modal visible={newListModal} transparent animationType="slide" onRequestClose={() => setNewListModal(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setNewListModal(false)}>
          <View style={[s.modalSheet, { paddingBottom: Math.max(40, insets.bottom+20) }]} onStartShouldSetResponder={() => true}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Nuevo presupuesto</Text>
            <Text style={s.fieldLabel}>Nombre</Text>
            <TextInput style={[s.input,{marginBottom:16}]} placeholder="Ej: Salario, Freelance..." placeholderTextColor={C.text3} value={newListName} onChangeText={setNewListName} autoFocus returnKeyType="done" />
            <Text style={s.fieldLabel}>Color</Text>
            <View style={s.colorRow}>
              {LIST_COLORS.map(color => (
                <TouchableOpacity key={color} style={[s.colorDot,{backgroundColor:color},newListColor===color&&s.colorDotSelected]} onPress={() => setNewListColor(color)} />
              ))}
            </View>
            <Text style={[s.fieldLabel,{marginTop:16}]}>Moneda</Text>
            <View style={s.toggleRow}>
              {CURRENCIES.map(cur => (
                <TouchableOpacity key={cur.code} style={[s.toggleBtn,newListCurrency.code===cur.code&&{borderColor:C.accent,backgroundColor:C.accentGlow}]} onPress={() => setNewListCurrency(cur)}>
                  <Text style={[s.toggleBtnText,newListCurrency.code===cur.code&&{color:C.accent2}]}>{cur.symbol} {cur.code}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[s.fieldLabel,{marginTop:16}]}>Período por defecto</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:20 }}>
              <View style={{ flexDirection:'row', gap:8 }}>
                {PERIODS.map(per => (
                  <TouchableOpacity key={per} style={[s.periodChip,newListPeriod===per&&{borderColor:C.accent,backgroundColor:C.accentGlow}]} onPress={() => setNewListPeriod(per)}>
                    <Text style={[s.periodChipText,newListPeriod===per&&{color:C.accent2}]}>{per}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TouchableOpacity style={s.btnAdd} onPress={confirmNewList}>
              <Text style={[s.btnAddText,{color:'#fff'}]}>✓ Crear presupuesto</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ MODAL EDITAR LISTA ══ */}
      <Modal visible={editListModal} transparent animationType="slide" onRequestClose={() => setEditListModal(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setEditListModal(false)}>
          <View style={[s.modalSheet,{paddingBottom:Math.max(40,insets.bottom+20)}]} onStartShouldSetResponder={() => true}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Editar presupuesto</Text>
            <Text style={s.fieldLabel}>Nombre</Text>
            <TextInput style={[s.input,{marginBottom:16}]} placeholder="Nombre del presupuesto" placeholderTextColor={C.text3} value={newListName} onChangeText={setNewListName} autoFocus returnKeyType="done" />
            <Text style={s.fieldLabel}>Color</Text>
            <View style={[s.colorRow,{marginBottom:20}]}>
              {LIST_COLORS.map(color => (
                <TouchableOpacity key={color} style={[s.colorDot,{backgroundColor:color},newListColor===color&&s.colorDotSelected]} onPress={() => setNewListColor(color)} />
              ))}
            </View>
            <TouchableOpacity style={s.btnAdd} onPress={confirmEditList}>
              <Text style={[s.btnAddText,{color:'#fff'}]}>✓ Guardar cambios</Text>
            </TouchableOpacity>
            {lists.length > 1 && (
              <TouchableOpacity style={[s.btnAdd,{backgroundColor:'transparent',borderWidth:1,borderColor:C.expense,marginTop:10}]}
                onPress={() => { setListToDelete(editingList); setEditListModal(false); setDeleteListModal(true); }}>
                <Text style={[s.btnAddText,{color:C.expense}]}>🗑 Eliminar presupuesto</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ MODAL ELIMINAR LISTA ══ */}
      <Modal visible={deleteListModal} transparent animationType="fade" onRequestClose={() => setDeleteListModal(false)}>
        <View style={s.finalizarOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setDeleteListModal(false)} activeOpacity={1} />
          <View style={s.finalizarCard}>
            <View style={s.finalizarHeader}><Text style={s.finalizarTitle}>🗑 Eliminar presupuesto</Text></View>
            <View style={s.finalizarContent}>
              <Text style={s.finalizarSub}>¿Eliminar "{listToDelete?.name}"? Se borrarán todos sus movimientos e historial. Esta acción no se puede deshacer.</Text>
            </View>
            <View style={s.finalizarActions}>
              <TouchableOpacity style={s.finalizarBtnCancel} onPress={() => setDeleteListModal(false)}>
                <Text style={s.finalizarBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.finalizarBtnConfirm,{backgroundColor:C.expense,borderColor:C.expense}]} onPress={confirmDeleteList}>
                <Text style={s.finalizarBtnConfirmText}>Eliminar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ══ DRAWER ══ */}
      <Modal visible={drawerVisible} transparent animationType="none" onRequestClose={() => closeDrawer()}>
        <View style={s.drawerOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => closeDrawer()} activeOpacity={1} />
          <Animated.View style={[s.drawerPanel, { transform:[{ translateX: drawerAnim }] }]}>
            <SafeAreaView edges={['top','left','bottom']} style={s.drawerSafe}>
              <View style={s.drawerHeader}>
                <Text style={s.drawerTitle}>💰 Mis Finanzas</Text>
                <TouchableOpacity onPress={() => closeDrawer()} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                  <Text style={s.drawerClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex:1 }} showsVerticalScrollIndicator={false}>

                {/* Mini resumen del período activo */}
                <View style={drawerMini.container}>
                  <View style={{ flexDirection:'row', alignItems:'center', gap:8, marginBottom:10 }}>
                    <View style={[s.listDot, { backgroundColor: activeList?.color || C.accent }]} />
                    <Text style={drawerMini.listName}>{activeList?.name}</Text>
                  </View>
                  <Text style={drawerMini.periodLabel}>{period} · Balance</Text>
                  <Text style={[drawerMini.balance, { color: totalBalance>=0?C.income:C.expense }]}>
                    {totalBalance>=0?'+':'−'} {fmt(Math.abs(totalBalance), currency.symbol)}
                  </Text>
                  <View style={drawerMini.row}>
                    <Text style={{ fontSize:11, color:C.income }}>↑ {fmt(totalIngreso,currency.symbol)}</Text>
                    <Text style={{ fontSize:11, color:C.expense }}>↓ {fmt(totalGasto,currency.symbol)}</Text>
                  </View>

                  {/* Botón consultar movimientos con badge */}
                  <TouchableOpacity
                    style={drawerMini.consultBtn}
                    onPress={() => closeDrawer(() => goToScreen('account'))}
                  >
                    <Text style={drawerMini.consultBtnText}>📋 Consultar movimientos</Text>
                    {periodMovementsCount > 0 && (
                      <View style={drawerMini.badge}>
                        <Text style={drawerMini.badgeText}>{periodMovementsCount}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Mis presupuestos */}
                <View style={s.drawerSection}>
                  <Text style={s.drawerSectionTitle}>📋 MIS PRESUPUESTOS</Text>
                  {lists.map(list => (
                    <TouchableOpacity key={list.id} style={[s.drawerItem,{marginBottom:8},list.id===activeListId&&{borderColor:list.color}]}
                      onPress={() => { switchList(list.id); closeDrawer(); }}>
                      <View style={[s.listDot,{backgroundColor:list.color,marginRight:10}]} />
                      <View style={{ flex:1 }}>
                        <Text style={s.drawerItemText}>{list.name}</Text>
                        <Text style={s.drawerItemSub}>{list.currency.symbol} · {list.period}{list.budget>0?` · ${fmt(list.budget,list.currency.symbol)}`:''}</Text>
                      </View>
                      {list.id===activeListId && <Text style={[s.drawerChevron,{color:list.color}]}>✓</Text>}
                    </TouchableOpacity>
                  ))}
                  {lists.length < MAX_LISTS && (
                    <TouchableOpacity style={s.drawerNewListBtn} onPress={() => closeDrawer(() => openNewListModal())}>
                      <Text style={s.drawerNewListText}>+ Nuevo presupuesto</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Historial */}
                <View style={s.drawerSection}>
                  <View style={s.drawerSectionHeader}>
                    <Text style={s.drawerSectionTitle}>📋 HISTORIAL — {activeList?.name?.toUpperCase()}</Text>
                    {history.length > 0 && (
                      <TouchableOpacity onPress={() => setClearHistoryModal(true)}>
                        <Text style={s.drawerClearHistory}>Borrar todo</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {history.length === 0 ? (
                    <View style={s.historyEmpty}>
                      <Text style={s.historyEmptyIcon}>📭</Text>
                      <Text style={s.historyEmptyText}>Aún no hay períodos guardados</Text>
                      <Text style={s.historyEmptySub}>Presioná "Finalizar {periodLabel(period)}" para guardar</Text>
                    </View>
                  ) : (
                    history.map(session => renderHistoryItem(session))
                  )}
                </View>

              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        </View>
      </Modal>

      {/* ══ MODAL CERRAR PERÍODO ══ */}
      <Modal visible={finalizarVisible} transparent animationType="none" onRequestClose={closeFinalizarModal}>
        <View style={s.finalizarOverlay}>
          <Animated.View style={[s.finalizarCard, {
            opacity: finalizarAnim,
            transform: [{ scale: finalizarAnim.interpolate({ inputRange:[0,1], outputRange:[0.85,1] }) }],
          }]}>
            <View style={s.finalizarHeader}>
              <Text style={s.finalizarTitle}>{periodConfirmLabel(period)}</Text>
            </View>
            <View style={s.finalizarContent}>
              <Text style={s.finalizarSub}>
                Se guardará el balance de "{activeList?.name}" en el historial y se limpiarán los movimientos del período.
              </Text>
              <View style={s.finalizarTotals}>
                <View style={s.finalizarTotal}>
                  <Text style={s.finalizarTotalLabel}>Ingreso</Text>
                  <Text style={[s.finalizarTotalValue,{color:C.income}]}>{fmt(totalIngreso,currency.symbol)}</Text>
                </View>
                <View style={s.finalizarDivider} />
                <View style={s.finalizarTotal}>
                  <Text style={s.finalizarTotalLabel}>Gasto</Text>
                  <Text style={[s.finalizarTotalValue,{color:C.expense}]}>{fmt(totalGasto,currency.symbol)}</Text>
                </View>
                <View style={s.finalizarDivider} />
                <View style={s.finalizarTotal}>
                  <Text style={s.finalizarTotalLabel}>Balance</Text>
                  <Text style={[s.finalizarTotalValue,{color:totalBalance>=0?C.income:C.expense}]}>
                    {totalBalance>=0?'+':'−'}{fmt(Math.abs(totalBalance),currency.symbol)}
                  </Text>
                </View>
              </View>
            </View>
            <View style={s.finalizarActions}>
              <TouchableOpacity style={s.finalizarBtnCancel} onPress={closeFinalizarModal}>
                <Text style={s.finalizarBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.finalizarBtnConfirm} onPress={confirmarFinalizar}>
                <Text style={s.finalizarBtnConfirmText}>✓ Finalizar</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* ══ MODAL BORRAR HISTORIAL ══ */}
      <Modal visible={clearHistoryModal} transparent animationType="fade" onRequestClose={() => setClearHistoryModal(false)}>
        <View style={s.finalizarOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setClearHistoryModal(false)} activeOpacity={1} />
          <View style={s.finalizarCard}>
            <View style={s.finalizarHeader}><Text style={s.finalizarTitle}>🗑 Borrar historial</Text></View>
            <View style={s.finalizarContent}>
              <Text style={s.finalizarSub}>¿Borrar todo el historial de "{activeList?.name}"? Esta acción no se puede deshacer.</Text>
            </View>
            <View style={s.finalizarActions}>
              <TouchableOpacity style={s.finalizarBtnCancel} onPress={() => setClearHistoryModal(false)}>
                <Text style={s.finalizarBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.finalizarBtnConfirm,{backgroundColor:C.expense,borderColor:C.expense}]}
                onPress={() => { updateActiveList(()=>({history:[]})); setClearHistoryModal(false); showToast('Historial borrado 🗑'); }}>
                <Text style={s.finalizarBtnConfirmText}>Borrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ══ MODAL LIMPIAR MOVIMIENTOS ══ */}
      <Modal visible={clearListModal} transparent animationType="fade" onRequestClose={() => setClearListModal(false)}>
        <View style={s.finalizarOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setClearListModal(false)} activeOpacity={1} />
          <View style={s.finalizarCard}>
            <View style={s.finalizarHeader}><Text style={s.finalizarTitle}>🗑 Limpiar movimientos</Text></View>
            <View style={s.finalizarContent}>
              <Text style={s.finalizarSub}>¿Borrar TODOS los movimientos de "{activeList?.name}"? Esta acción no se puede deshacer.</Text>
              <View style={s.finalizarTotals}>
                <View style={s.finalizarTotal}><Text style={s.finalizarTotalLabel}>Registros</Text><Text style={s.finalizarTotalValue}>{movements.length}</Text></View>
                <View style={s.finalizarDivider} />
                <View style={s.finalizarTotal}>
                  <Text style={s.finalizarTotalLabel}>Balance ({period})</Text>
                  <Text style={[s.finalizarTotalValue,{color:totalBalance>=0?C.income:C.expense}]}>
                    {totalBalance>=0?'+':'−'}{fmt(Math.abs(totalBalance),currency.symbol)}
                  </Text>
                </View>
              </View>
            </View>
            <View style={s.finalizarActions}>
              <TouchableOpacity style={s.finalizarBtnCancel} onPress={() => setClearListModal(false)}>
                <Text style={s.finalizarBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.finalizarBtnConfirm,{backgroundColor:C.expense,borderColor:C.expense}]}
                onPress={() => { updateActiveList(()=>({movements:[]})); setClearListModal(false); showToast('Movimientos eliminados 🗑'); }}>
                <Text style={s.finalizarBtnConfirmText}>Limpiar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ══ MODAL REUTILIZAR ══ */}
      <Modal visible={reuseModalVisible} transparent animationType="fade" onRequestClose={() => { setReuseModalVisible(false); setReuseSession(null); }}>
        <View style={s.finalizarOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => { setReuseModalVisible(false); setReuseSession(null); }} activeOpacity={1} />
          <View style={s.finalizarCard}>
            <View style={s.finalizarHeader}><Text style={s.finalizarTitle}>↩ Reutilizar período</Text></View>
            <View style={s.finalizarContent}>
              <Text style={s.finalizarSub}>
                {reuseSession ? `Se cargarán los movimientos del período ${reuseSession.period} (${reuseSession.date}) con fecha actual.` : ''}
              </Text>
              {reuseSession && (
                <View style={s.finalizarTotals}>
                  <View style={s.finalizarTotal}><Text style={s.finalizarTotalLabel}>Registros</Text><Text style={s.finalizarTotalValue}>{reuseSession.movements.length}</Text></View>
                  <View style={s.finalizarDivider} />
                  <View style={s.finalizarTotal}>
                    <Text style={s.finalizarTotalLabel}>Balance</Text>
                    <Text style={[s.finalizarTotalValue,{color:reuseSession.balance>=0?C.income:C.expense}]}>
                      {reuseSession.balance>=0?'+':'−'}{fmt(Math.abs(reuseSession.balance),reuseSession.currency||currency.symbol)}
                    </Text>
                  </View>
                </View>
              )}
            </View>
            <View style={s.finalizarActions}>
              <TouchableOpacity style={s.finalizarBtnCancel} onPress={() => { setReuseModalVisible(false); setReuseSession(null); }}>
                <Text style={s.finalizarBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.finalizarBtnConfirm} onPress={confirmRestoreFromHistory}>
                <Text style={s.finalizarBtnConfirmText}>↩ Reutilizar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ══ MODAL PERÍODO ══ */}
      <Modal visible={periodModalVisible} transparent animationType="slide" onRequestClose={() => setPeriodModalVisible(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setPeriodModalVisible(false)}>
          <View style={[s.modalSheet,{paddingBottom:Math.max(40,insets.bottom+20)}]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Seleccionar período</Text>
            <Text style={s.sheetSub}>Filtra los totales y movimientos mostrados</Text>
            {PERIODS.map(p => (
              <TouchableOpacity key={p} style={[s.pdfOption,period===p&&{borderColor:C.accent}]} onPress={() => selectPeriod(p)}>
                <Text style={s.pdfOptionIcon}>{p==='Diario'?'📆':p==='Semanal'?'📅':p==='Bisemanal'?'📋':p==='Quincenal'?'📊':'🗓'}</Text>
                <View style={{ flex:1 }}>
                  <Text style={s.pdfOptionTitle}>{p}</Text>
                  <Text style={s.pdfOptionSub}>{p==='Diario'?'Solo movimientos de hoy':p==='Semanal'?'Esta semana (lunes a domingo)':p==='Bisemanal'?'Últimas 2 semanas':p==='Quincenal'?'1–15 o 16–fin de mes':'Este mes calendario'}</Text>
                </View>
                {period===p && <Text style={{color:C.accent,fontSize:20}}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ MODAL MONEDA ══ */}
      <Modal visible={currencyModalVisible} transparent animationType="slide" onRequestClose={() => setCurrencyModalVisible(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setCurrencyModalVisible(false)}>
          <View style={[s.modalSheet,{paddingBottom:Math.max(40,insets.bottom+20)}]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Moneda de "{activeList?.name}"</Text>
            <Text style={s.sheetSub}>Solo aplica a este presupuesto</Text>
            {CURRENCIES.map(cur => (
              <TouchableOpacity key={cur.code} style={[s.pdfOption,currency.code===cur.code&&{borderColor:C.accent}]} onPress={() => selectCurrency(cur)}>
                <Text style={s.pdfOptionIcon}>{cur.symbol}</Text>
                <View><Text style={s.pdfOptionTitle}>{cur.label}</Text><Text style={s.pdfOptionSub}>Código: {cur.code}</Text></View>
                {currency.code===cur.code && <Text style={{marginLeft:'auto',color:C.accent,fontSize:20}}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ MODAL PRESUPUESTO ══ */}
      <Modal visible={budgetModalVisible} transparent animationType="fade" onRequestClose={() => setBudgetModalVisible(false)}>
        <TouchableOpacity style={[s.budgetOverlay,{paddingTop:insets.top+70}]} activeOpacity={1} onPress={() => setBudgetModalVisible(false)}>
          <View style={s.budgetCard} onStartShouldSetResponder={() => true}>
            <Text style={s.budgetCardTitle}>💰 Presupuesto — {activeList?.name}</Text>
            <Text style={s.budgetCardSub}>La app te avisará cuando estés cerca de superarlo</Text>
            <TextInput style={[s.input,{marginBottom:20,fontSize:22}]} placeholder="Ej: 50000" placeholderTextColor={C.text3} value={budgetInput} onChangeText={setBudgetInput} keyboardType="numeric" selectTextOnFocus autoFocus />
            <View style={s.budgetBtnRow}>
              <TouchableOpacity style={s.budgetBtnSave} onPress={saveBudget}>
                <Text style={s.budgetBtnSaveText}>✓ Guardar</Text>
              </TouchableOpacity>
              {budget > 0 ? (
                <TouchableOpacity style={s.budgetBtnDeactivate} onPress={() => { updateActiveList(()=>({budget:0})); setBudgetModalVisible(false); showToast('Presupuesto desactivado'); }}>
                  <Text style={s.budgetBtnDeactivateText}>🚫 Desactivar</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={s.budgetBtnCancel} onPress={() => setBudgetModalVisible(false)}>
                  <Text style={s.budgetBtnCancelText}>Cancelar</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ══ CALENDAR ══ */}
      <CalendarPicker
        visible={datePickerVisible}
        currentDateStr={dateInput}
        movements={movements}
        onConfirm={(str) => { setDateInput(str); setDatePickerVisible(false); }}
        onCancel={() => setDatePickerVisible(false)}
      />

    </SafeAreaView>
  );
}

// ─────────────────────────────────────────
// ESTILOS
// ─────────────────────────────────────────
const todaySection = StyleSheet.create({
  header: { paddingHorizontal:16, paddingTop:12, paddingBottom:4, backgroundColor:C.bg },
  title:  { fontSize:12, fontWeight:'700', color:C.text3, letterSpacing:0.8, textTransform:'uppercase' },
});

const acctSection = StyleSheet.create({
  container: {
    backgroundColor:C.surface, borderRadius:16, borderWidth:1, borderColor:C.border,
    marginBottom:14, padding:14,
  },
  containerToday: {
    borderColor: C.accent,
    backgroundColor: 'rgba(79,142,247,0.06)',
  },
  containerFuture: {
    borderColor: 'rgba(224,184,74,0.35)',
    backgroundColor: 'rgba(224,184,74,0.04)',
  },
  dayHeader:      { flexDirection:'row', alignItems:'center', marginBottom:6 },
  dayTitle:       { fontSize:14, fontWeight:'700', color:C.text2 },
  dayBalance:     { fontSize:15, fontWeight:'700', marginLeft:8 },
  divider:        { height:1, backgroundColor:C.border, marginBottom:8 },
  dayTotals:      { flexDirection:'row', justifyContent:'flex-end', gap:14, paddingTop:8, marginTop:4, borderTopWidth:1, borderTopColor:C.border },
  dayTotalText:   { fontSize:12, fontWeight:'600' },
  periodTotal: {
    backgroundColor:C.surface, borderRadius:12, borderWidth:1, borderColor:C.accent,
    padding:16, alignItems:'center', gap:4,
  },
  periodTotalLabel: { fontSize:12, color:C.text3, fontWeight:'500' },
  periodTotalValue: { fontSize:20, fontWeight:'700' },
});

const drawerMini = StyleSheet.create({
  container: {
    margin:16, backgroundColor:C.surface2, borderRadius:16,
    borderWidth:1, borderColor:C.border, padding:16,
  },
  listName:    { fontSize:15, fontWeight:'700', color:C.text, flex:1 },
  periodLabel: { fontSize:11, color:C.text3, fontWeight:'500', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 },
  balance:     { fontSize:22, fontWeight:'700', marginBottom:4 },
  row:         { flexDirection:'row', justifyContent:'space-between', marginBottom:12 },
  consultBtn: {
    backgroundColor:C.accentGlow, borderWidth:1, borderColor:C.accent,
    borderRadius:12, paddingVertical:12, paddingHorizontal:14,
    flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8,
  },
  consultBtnText: { fontSize:14, fontWeight:'700', color:C.accent2 },
  badge: {
    backgroundColor:C.accent, borderRadius:99,
    minWidth:22, height:22, alignItems:'center', justifyContent:'center',
    paddingHorizontal:6,
  },
  badgeText: { fontSize:12, fontWeight:'700', color:'#fff' },
});

const s = StyleSheet.create({
  safeArea: { flex:1, backgroundColor:C.surface },
  flex:     { flex:1, backgroundColor:C.bg },

  splashContainer: { flex:1, backgroundColor:C.bg, justifyContent:'space-between', alignItems:'center', paddingVertical:60 },
  splashContent:   { flex:1, justifyContent:'center', alignItems:'center', width:'100%' },
  splashEmoji:     { fontSize:70, marginBottom:15, textAlign:'center', width:'100%' },
  splashTitle:     { fontSize:32, fontWeight:'800', color:C.accent2, letterSpacing:1, marginBottom:8 },
  splashSubtitle:  { fontSize:14, color:C.text3, fontWeight:'400' },
  splashFooter:    { alignItems:'center', gap:4 },
  splashVersion:   { fontSize:12, color:C.surface3, fontWeight:'600' },
  splashCredits:   { fontSize:13, color:C.text3, fontStyle:'italic', letterSpacing:0.5 },

  header:      { backgroundColor:C.surface, paddingHorizontal:16, paddingTop:12, paddingBottom:10, borderBottomWidth:1, borderBottomColor:C.border, gap:10 },
  headerTop:   { flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  headerActions: { flexDirection:'row', gap:8 },
  btnIcon:     { width:38, height:38, borderRadius:19, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center', justifyContent:'center' },
  btnIconText: { fontSize:14, color:C.text2 },
  btnHamburger:{ width:38, height:38, borderRadius:19, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center', justifyContent:'center', gap:4, paddingVertical:8 },
  hamburgerLine:{ width:16, height:2, borderRadius:1, backgroundColor:C.text2 },

  listSelector:       { flex:1, flexDirection:'row', alignItems:'center', gap:8, marginHorizontal:10, paddingVertical:6, paddingHorizontal:12, borderRadius:20, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2 },
  listDot:            { width:10, height:10, borderRadius:5 },
  listSelectorName:   { flex:1, fontSize:15, fontWeight:'700', color:C.text },
  listSelectorChevron:{ fontSize:12, color:C.text3 },

  btnCurrency:    { width:38, height:38, borderRadius:19, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center', justifyContent:'center' },
  btnCurrencyText:{ fontSize:15, fontWeight:'700', color:C.accent2 },

  periodSelectorRow: { flexDirection:'row', gap:8, alignItems:'center' },
  periodSelectorBtn: { flexDirection:'row', alignItems:'center', gap:6, paddingVertical:7, paddingHorizontal:14, borderRadius:20, borderWidth:1, borderColor:C.accent, backgroundColor:C.accentGlow },
  periodSelectorText:    { fontSize:13, color:C.accent2, fontWeight:'600' },
  periodSelectorChevron: { fontSize:12, color:C.accent2 },
  btnBudgetConfig:     { flexDirection:'row', alignItems:'center', paddingVertical:7, paddingHorizontal:14, borderRadius:20, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, flex:1 },
  btnBudgetConfigText: { fontSize:12, color:C.text2, fontWeight:'500', flex:1, textAlign:'center' },

  budgetBar:   { gap:4 },
  budgetTrack: { height:4, backgroundColor:C.surface3, borderRadius:2, overflow:'hidden' },
  budgetFill:  { height:'100%', backgroundColor:C.accent, borderRadius:2 },
  budgetText:  { fontSize:11, color:C.text3 },

  totalsRow: { flexDirection:'row', gap:6 },
  totalCard: { flex:1, backgroundColor:C.surface2, borderRadius:10, paddingVertical:8, paddingHorizontal:10, borderWidth:1, borderColor:C.border },
  totalCardIncome:  { borderColor:'rgba(79,207,138,0.25)' },
  totalCardExpense: { borderColor:'rgba(224,112,112,0.25)' },
  totalCardBalance: { borderColor:'rgba(79,142,247,0.3)' },
  totalLabel:  { fontSize:9, color:C.text3, fontWeight:'500', letterSpacing:0.5, textTransform:'uppercase' },
  totalAmount: { fontSize:13, fontWeight:'700', color:C.accent, marginTop:2 },

  addSection: { paddingHorizontal:16, paddingVertical:12, backgroundColor:C.surface, borderBottomWidth:1, borderBottomColor:C.border, gap:10 },
  descRow:    { flexDirection:'row', alignItems:'center', gap:8 },
  inputGroup: { flexDirection:'row', gap:8 },
  fieldWrap:  { flex:1, gap:4 },
  fieldLabel: { fontSize:11, color:C.text3, fontWeight:'500', letterSpacing:0.5, textTransform:'uppercase', marginBottom:2 },
  input:      { backgroundColor:C.surface2, borderWidth:1, borderColor:C.border, borderRadius:10, color:C.text, fontSize:15, paddingVertical:11, paddingHorizontal:14 },
  btnAdd:     { borderRadius:10, paddingVertical:13, alignItems:'center', justifyContent:'center', backgroundColor:C.accent },
  btnAddText: { color:'#fff', fontSize:15, fontWeight:'700', letterSpacing:0.3 },

  toggleRow: { flexDirection:'row', gap:8 },
  toggleBtn: { flex:1, paddingVertical:10, borderRadius:10, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center', justifyContent:'center' },
  toggleBtnIncomeActive:       { backgroundColor:'rgba(79,207,138,0.18)', borderColor:C.income },
  toggleBtnExpenseActive:      { backgroundColor:'rgba(224,112,112,0.18)', borderColor:C.expense },
  toggleBtnText:               { fontSize:14, fontWeight:'600', color:C.text3 },
  toggleBtnTextActiveIncome:   { color:C.income },
  toggleBtnTextActiveExpense:  { color:C.expense },

  searchSection: { paddingHorizontal:16, paddingTop:10, paddingBottom:4, backgroundColor:C.bg },
  searchWrap:    { flexDirection:'row', alignItems:'center', position:'relative' },
  searchIcon:    { position:'absolute', left:14, fontSize:15, zIndex:1 },
  searchInput:   { flex:1, backgroundColor:C.surface, borderWidth:1, borderColor:C.border, borderRadius:10, color:C.text, fontSize:15, paddingVertical:11, paddingLeft:42, paddingRight:40 },
  searchClear:   { position:'absolute', right:12, width:22, height:22, borderRadius:11, backgroundColor:C.surface3, alignItems:'center', justifyContent:'center', zIndex:1 },
  searchClearText:{ color:C.text3, fontSize:14, fontWeight:'700', lineHeight:22 },

  list:        { flex:1 },
  listContent: { padding:12, paddingBottom:16 },
  emptyState:  { alignItems:'center', paddingVertical:60, paddingHorizontal:20 },
  emptyEmoji:  { fontSize:56, marginBottom:16 },
  emptyText:   { fontSize:18, fontStyle:'italic', color:C.text2, textAlign:'center' },
  emptySmall:  { fontSize:14, color:C.text3, marginTop:8, textAlign:'center' },

  card:        { backgroundColor:C.surface, borderWidth:1, borderColor:C.border, borderRadius:16, marginBottom:10, padding:14, flexDirection:'row', alignItems:'center', gap:12 },
  cardIncome:  { borderLeftWidth:3, borderLeftColor:C.income },
  cardExpense: { borderLeftWidth:3, borderLeftColor:C.expense },
  typeIcon:    { width:32, height:32, borderRadius:16, alignItems:'center', justifyContent:'center' },
  typeIconIncome:  { backgroundColor:'rgba(79,207,138,0.15)' },
  typeIconExpense: { backgroundColor:'rgba(224,112,112,0.15)' },
  typeIconText:    { fontSize:16, fontWeight:'700', color:C.text2 },
  itemInfo:    { flex:1, minWidth:0 },
  itemName:    { fontSize:15, fontWeight:'500', color:C.text },
  itemMeta:    { flexDirection:'row', alignItems:'center', gap:8, marginTop:4, flexWrap:'wrap' },
  amountIncome:  { color:C.income },
  amountExpense: { color:C.expense },
  amountEditWrap:{ flexDirection:'row', alignItems:'center', gap:2 },
  amountPrefix:  { fontSize:14, fontWeight:'700' },
  itemDate:      { fontSize:12, color:C.text3 },
  deleteBtn:     { width:34, height:34, borderRadius:17, alignItems:'center', justifyContent:'center' },
  deleteBtnText: { fontSize:18 },

  bottomBar: {
    backgroundColor:C.surface, borderTopWidth:1, borderTopColor:C.border,
    paddingHorizontal:16, paddingTop:12, flexDirection:'row', gap:8,
  },
  btnBottom:  { flex:1, paddingVertical:13, paddingHorizontal:8, borderRadius:10, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center', justifyContent:'center' },
  btnPrimary: { backgroundColor:C.accent, borderColor:C.accent },
  btnBottomText: { fontSize:13, fontWeight:'600', color:C.text2 },

  toast:     { position:'absolute', alignSelf:'center', backgroundColor:C.accent, paddingVertical:10, paddingHorizontal:20, borderRadius:99, zIndex:999 },
  toastText: { color:'#fff', fontSize:14, fontWeight:'700' },

  drawerOverlay: { flex:1, flexDirection:'row' },
  drawerPanel:   { width:DRAWER_WIDTH, backgroundColor:C.drawerBg, borderRightWidth:1, borderRightColor:C.border, shadowColor:'#000', shadowOffset:{width:8,height:0}, shadowOpacity:0.5, shadowRadius:16, elevation:24 },
  drawerSafe:    { flex:1 },
  drawerHeader:  { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:20, paddingVertical:16, borderBottomWidth:1, borderBottomColor:C.border },
  drawerTitle:   { fontSize:20, fontWeight:'700', color:C.accent2 },
  drawerClose:   { fontSize:20, color:C.text3 },
  drawerSection: { paddingHorizontal:16, paddingTop:20, paddingBottom:8 },
  drawerSectionHeader: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:12 },
  drawerSectionTitle:  { fontSize:11, color:C.text3, fontWeight:'700', letterSpacing:1, textTransform:'uppercase', marginBottom:12 },
  drawerClearHistory:  { fontSize:12, color:C.expense },
  drawerItem:    { flexDirection:'row', alignItems:'center', paddingVertical:14, paddingHorizontal:14, backgroundColor:C.surface2, borderRadius:12, borderWidth:1, borderColor:C.border },
  drawerItemText:{ fontSize:15, fontWeight:'600', color:C.text },
  drawerItemSub: { fontSize:12, color:C.text3, marginTop:2 },
  drawerChevron: { fontSize:20, color:C.text3 },
  drawerNewListBtn: { marginTop:8, paddingVertical:12, borderRadius:12, borderWidth:1, borderColor:C.accent, borderStyle:'dashed', alignItems:'center', backgroundColor:C.accentGlow },
  drawerNewListText:{ color:C.accent, fontSize:14, fontWeight:'600' },

  listItem:       { flexDirection:'row', alignItems:'center', paddingVertical:14, paddingHorizontal:14, backgroundColor:C.surface2, borderRadius:12, borderWidth:1, borderColor:C.border, marginBottom:10 },
  listItemDot:    { width:12, height:12, borderRadius:6, marginRight:12 },
  listItemName:   { fontSize:15, fontWeight:'600', color:C.text },
  listItemSub:    { fontSize:12, color:C.text3, marginTop:2 },
  listItemActions:{ flexDirection:'row', alignItems:'center', gap:10 },
  listItemCheck:  { fontSize:18, fontWeight:'700' },
  listItemEditBtn:{ width:30, height:30, alignItems:'center', justifyContent:'center' },
  listItemEditText:{ fontSize:16, color:C.text3 },
  btnNewList:     { paddingVertical:14, borderRadius:12, borderWidth:1, borderColor:C.accent, borderStyle:'dashed', alignItems:'center', backgroundColor:C.accentGlow, marginTop:4 },
  btnNewListText: { color:C.accent, fontSize:15, fontWeight:'600' },
  maxListsNote:   { fontSize:12, color:C.text3, textAlign:'center', marginTop:8 },

  colorRow: { flexDirection:'row', gap:12, marginBottom:4 },
  colorDot: { width:36, height:36, borderRadius:18, borderWidth:2, borderColor:'transparent' },
  colorDotSelected: { borderColor:'#fff', transform:[{scale:1.15}] },

  periodChip:     { paddingVertical:8, paddingHorizontal:16, borderRadius:20, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2 },
  periodChipText: { fontSize:13, color:C.text3, fontWeight:'500' },

  historyEmpty:      { alignItems:'center', paddingVertical:24 },
  historyEmptyIcon:  { fontSize:36, marginBottom:8 },
  historyEmptyText:  { fontSize:14, color:C.text2, textAlign:'center' },
  historyEmptySub:   { fontSize:12, color:C.text3, textAlign:'center', marginTop:4, lineHeight:18 },
  historyCard:       { backgroundColor:C.surface2, borderRadius:12, borderWidth:1, borderColor:C.border, marginBottom:10, overflow:'hidden' },
  historyHeader:     { flexDirection:'row', alignItems:'center', paddingVertical:12, paddingHorizontal:14 },
  historyDate:       { fontSize:14, fontWeight:'600', color:C.text2 },
  historyTime:       { fontSize:12, color:C.text3, marginTop:2 },
  historyRestoreHint:{ fontSize:11, color:C.accent, marginTop:4, fontStyle:'italic' },
  historyBalance:    { fontSize:16, fontWeight:'700', color:C.accent },
  historyRestoreTag: { marginTop:6, backgroundColor:C.accentGlow, borderWidth:1, borderColor:C.border, borderRadius:6, paddingVertical:3, paddingHorizontal:8 },
  historyRestoreTagText: { fontSize:11, color:C.accent, fontWeight:'600', letterSpacing:0.3 },
  historyItems:      { borderTopWidth:1, borderTopColor:C.border, paddingVertical:10, paddingHorizontal:14 },
  historyRow:        { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:5 },
  historyItemName:   { flex:1, fontSize:13, color:C.text2 },
  historyItemPrice:  { fontSize:13, fontWeight:'600', marginLeft:8 },
  historyTotalRow:   { flexDirection:'row', justifyContent:'space-between', marginTop:6, paddingTop:6, borderTopWidth:1, borderTopColor:C.border },
  historyTotalLabel: { fontSize:12, color:C.text3, fontWeight:'600', textTransform:'uppercase' },
  historyTotalVal:   { fontSize:14, fontWeight:'700' },
  historyRestoreBtn: { marginTop:12, backgroundColor:C.accent, borderRadius:10, paddingVertical:11, alignItems:'center', flexDirection:'row', justifyContent:'center', gap:6 },
  historyRestoreBtnText: { color:'#fff', fontSize:14, fontWeight:'700', letterSpacing:0.2 },

  finalizarOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.6)', alignItems:'center', justifyContent:'center', paddingHorizontal:20 },
  finalizarCard:    { backgroundColor:C.surface, borderRadius:20, borderWidth:1, borderColor:C.border, paddingHorizontal:20, paddingVertical:24, width:'100%', maxWidth:360, shadowColor:'#000', shadowOffset:{width:0,height:12}, shadowOpacity:0.5, shadowRadius:20, elevation:16 },
  finalizarHeader:  { marginBottom:16, alignItems:'center' },
  finalizarTitle:   { fontSize:22, fontWeight:'700', color:C.accent2, letterSpacing:0.2 },
  finalizarContent: { marginBottom:20, gap:16 },
  finalizarSub:     { fontSize:14, color:C.text3, textAlign:'center' },
  finalizarTotals:  { flexDirection:'row', alignItems:'center', backgroundColor:C.surface2, borderRadius:14, borderWidth:1, borderColor:C.border, paddingVertical:12, paddingHorizontal:12 },
  finalizarTotal:   { flex:1, alignItems:'center' },
  finalizarDivider: { width:1, height:40, backgroundColor:C.border, marginHorizontal:8 },
  finalizarTotalLabel: { fontSize:10, color:C.text3, fontWeight:'500', letterSpacing:0.4, textTransform:'uppercase', marginBottom:4 },
  finalizarTotalValue: { fontSize:14, fontWeight:'700', color:C.accent },
  finalizarActions: { flexDirection:'row', gap:12 },
  finalizarBtnCancel:  { flex:1, paddingVertical:12, paddingHorizontal:12, borderRadius:12, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center' },
  finalizarBtnCancelText:  { fontSize:14, fontWeight:'600', color:C.text2 },
  finalizarBtnConfirm:     { flex:1, paddingVertical:12, paddingHorizontal:12, borderRadius:12, backgroundColor:C.accent, alignItems:'center', borderWidth:1, borderColor:C.accent },
  finalizarBtnConfirmText: { fontSize:14, fontWeight:'700', color:'#fff' },

  modalOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.7)', justifyContent:'flex-end' },
  modalSheet:   { backgroundColor:C.surface, borderTopLeftRadius:24, borderTopRightRadius:24, padding:20, paddingBottom:40, borderTopWidth:1, borderTopColor:C.border },
  sheetHandle:  { width:40, height:4, backgroundColor:C.surface3, borderRadius:2, alignSelf:'center', marginBottom:20 },
  sheetTitle:   { fontSize:22, fontWeight:'700', color:C.accent2, marginBottom:4 },
  sheetSub:     { fontSize:13, color:C.text3, marginBottom:20 },
  pdfOption:    { flexDirection:'row', alignItems:'center', gap:14, paddingVertical:14, paddingHorizontal:14, backgroundColor:C.surface2, borderRadius:10, borderWidth:1, borderColor:C.border, marginBottom:10 },
  pdfOptionIcon:  { fontSize:24 },
  pdfOptionTitle: { fontSize:15, fontWeight:'600', color:C.text, marginBottom:2 },
  pdfOptionSub:   { fontSize:12, color:C.text3 },

  budgetOverlay:       { flex:1, backgroundColor:'rgba(0,0,0,0.7)', justifyContent:'flex-start', paddingHorizontal:24 },
  budgetCard:          { backgroundColor:C.surface, borderRadius:20, borderWidth:1, borderColor:C.border, padding:22, shadowColor:'#000', shadowOffset:{width:0,height:12}, shadowOpacity:0.5, shadowRadius:20, elevation:16 },
  budgetCardTitle:     { fontSize:20, fontWeight:'700', color:C.accent2, marginBottom:4 },
  budgetCardSub:       { fontSize:13, color:C.text3, marginBottom:18 },
  budgetBtnRow:        { flexDirection:'row', gap:10 },
  budgetBtnSave:       { flex:1, backgroundColor:C.accent, borderRadius:12, paddingVertical:14, alignItems:'center', justifyContent:'center' },
  budgetBtnSaveText:   { color:C.bg, fontSize:15, fontWeight:'700', letterSpacing:0.3 },
  budgetBtnDeactivate: { flex:1, borderRadius:12, borderWidth:1, borderColor:'rgba(224,112,112,0.45)', backgroundColor:'rgba(224,112,112,0.1)', paddingVertical:14, alignItems:'center', justifyContent:'center' },
  budgetBtnDeactivateText: { fontSize:14, fontWeight:'600', color:C.expense, letterSpacing:0.2 },
  budgetBtnCancel:     { flex:1, borderRadius:12, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, paddingVertical:14, alignItems:'center', justifyContent:'center' },
  budgetBtnCancelText: { fontSize:14, fontWeight:'600', color:C.text2 },

  btnToggleForm:     { alignItems:'center', paddingVertical:7 },
  btnToggleFormText: { fontSize:11, color:C.text3, fontWeight:'500', letterSpacing:0.6 },
});
