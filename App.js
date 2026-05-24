/**
 * Mis Finanzas v3.1
 * Basado en v3.0 por ALVA
 *
 * Cambios v3.1:
 * ✅ Totales del header filtrados por período activo
 * ✅ Lista de movimientos muestra los de la fecha seleccionada en el calendario
 * ✅ Editar monto de movimiento con tap en el monto
 * ✅ Botón eliminar directo (✕) en cada tarjeta de movimiento
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.80, 320);
const LISTS_KEY    = 'finanzas_lists_v3';
const ACTIVE_KEY   = 'finanzas_active_list_v3';

const CURRENCIES = [
  { symbol: '₡', code: 'CRC', label: 'Colón' },
  { symbol: '$', code: 'USD', label: 'Dólar' },
  { symbol: '€', code: 'EUR', label: 'Euro'  },
];

const PERIODS = ['Diario', 'Semanal', 'Quincenal', 'Mensual'];

const LIST_COLORS = [
  '#4f8ef7',
  '#4fcf8a',
  '#e07070',
  '#e0b84a',
  '#b07ef7',
];

const MAX_LISTS = 5;

// ─── PALETA ───────────────────────────────
const C = {
  bg:         '#0d1520',
  surface:    '#131f30',
  surface2:   '#1a2840',
  surface3:   '#223350',
  accent:     '#4f8ef7',
  accent2:    '#7eb3ff',
  accentGlow: 'rgba(79,142,247,0.15)',
  income:     '#4fcf8a',
  expense:    '#e07070',
  text:       '#e0eaf8',
  text2:      '#8aaacf',
  text3:      '#4a6080',
  border:     'rgba(79,142,247,0.18)',
  drawerBg:   '#0b1525',
  warning:    '#e0b84a',
};

// ─── HELPERS ──────────────────────────────
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

const isInFilter = (dateStr, filter) => {
  const d     = parseDateStr(dateStr);
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (filter === 'Diario') {
    return itemDay.getTime() === today.getTime();
  }
  if (filter === 'Semanal') {
    const dow = today.getDay();
    const mon = new Date(today); mon.setDate(today.getDate() - ((dow+6)%7));
    const sun = new Date(mon);   sun.setDate(mon.getDate() + 6);
    return itemDay >= mon && itemDay <= sun;
  }
  if (filter === 'Quincenal') {
    const day = now.getDate();
    if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
    return day <= 15 ? (d.getDate() >= 1 && d.getDate() <= 15) : d.getDate() >= 16;
  }
  if (filter === 'Mensual') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  return true;
};

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

const createList = ({ name, color, currency, period }) => ({
  id:               Date.now().toString() + Math.random().toString(36).slice(2),
  name:             name     || 'Mi presupuesto',
  color:            color    || LIST_COLORS[0],
  currency:         currency || CURRENCIES[0],
  period:           period   || 'Mensual',
  budget:           0,
  movements:        [],
  savedMovements:   [],
  closedPeriods:    [],
});

// ─── STORAGE ──────────────────────────────
const load    = async (key, fallback) => {
  try { const v = await AsyncStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};
const persist = async (key, value) => {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch {}
};

// ═══════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════
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
          <Text style={s.splashVersion}>v3.1</Text>
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

// ═══════════════════════════════════════════
// CALENDAR PICKER
// ═══════════════════════════════════════════
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

  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const offset      = (firstDay + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
  const cells       = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const activityMap = {};
  movements.forEach(m => {
    const mp = m.date.split('/');
    if (mp.length !== 3) return;
    const mY = parseInt(mp[2]), mM = parseInt(mp[1])-1, mD = parseInt(mp[0]);
    if (mY === viewYear && mM === viewMonth) {
      if (!activityMap[mD]) activityMap[mD] = { income: 0, expense: 0, total: 0 };
      if (m.type === 'income') activityMap[mD].income += parseFloat(m.amount) || 0;
      else                     activityMap[mD].expense += parseFloat(m.amount) || 0;
      activityMap[mD].total += parseFloat(m.amount) || 0;
    }
  });
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
              const activity  = d ? activityMap[d] : null;
              const intensity = activity ? Math.min(activity.total / maxAmount, 1) : 0;
              const heatBg    = activity && intensity > 0
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
              <Text style={cal.btnConfirmText}>Confirmar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const cal = StyleSheet.create({
  overlay:          { flex:1, backgroundColor:'rgba(0,0,0,0.72)', alignItems:'center', justifyContent:'center', paddingHorizontal:20 },
  card:             { backgroundColor:C.surface, borderRadius:20, borderWidth:1, borderColor:C.border, paddingHorizontal:16, paddingVertical:20, width:'100%', maxWidth:340, shadowColor:'#000', shadowOffset:{width:0,height:12}, shadowOpacity:0.5, shadowRadius:20, elevation:16 },
  navRow:           { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:16 },
  navBtn:           { width:36, height:36, borderRadius:18, backgroundColor:C.surface2, borderWidth:1, borderColor:C.border, alignItems:'center', justifyContent:'center' },
  navArrow:         { fontSize:22, color:C.accent2, fontWeight:'700', lineHeight:26 },
  navTitle:         { fontSize:16, fontWeight:'700', color:C.text, letterSpacing:0.3 },
  weekRow:          { flexDirection:'row', marginBottom:8 },
  weekDay:          { flex:1, textAlign:'center', fontSize:11, fontWeight:'600', color:C.text3, textTransform:'uppercase', letterSpacing:0.5 },
  grid:             { flexDirection:'row', flexWrap:'wrap' },
  cell:             { width:`${100/7}%`, aspectRatio:1, alignItems:'center', justifyContent:'center', borderRadius:99 },
  cellEmpty:        { opacity:0 },
  cellToday:        { borderWidth:2, borderColor:C.accent, shadowColor:C.accent, shadowOffset:{width:0,height:0}, shadowOpacity:0.6, shadowRadius:6, elevation:4 },
  cellSelected:     { backgroundColor:C.accent },
  cellText:         { fontSize:14, color:C.text2, fontWeight:'400' },
  cellTextToday:    { color:C.accent2, fontWeight:'700' },
  cellTextSelected: { color:'#fff', fontWeight:'700' },
  dotsRow:          { flexDirection:'row', gap:2, position:'absolute', bottom:3 },
  dot:              { width:4, height:4, borderRadius:2 },
  actions:          { flexDirection:'row', gap:10, marginTop:16 },
  btnCancel:        { flex:1, paddingVertical:12, borderRadius:12, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center' },
  btnCancelText:    { fontSize:14, fontWeight:'600', color:C.text2 },
  btnConfirm:       { flex:1, paddingVertical:12, borderRadius:12, backgroundColor:C.accent, alignItems:'center' },
  btnConfirmText:   { fontSize:14, fontWeight:'700', color:'#fff' },
});

// ═══════════════════════════════════════════
// SWIPEABLE MOVEMENT ROW (pantalla principal)
// ═══════════════════════════════════════════
function SwipeableMovementRow({ item, onDelete, onEdit, currencySymbol }) {
  const translateX      = useRef(new Animated.Value(0)).current;
  const SWIPE_THRESHOLD = -72;

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder:  (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dy) < 20,
    onPanResponderMove:   (_, g) => { const x = Math.max(g.dx, -100); if (x < 0) translateX.setValue(x); },
    onPanResponderRelease:(_, g) => {
      if (g.dx < SWIPE_THRESHOLD) {
        Animated.timing(translateX, { toValue:-80, duration:120, useNativeDriver:true }).start();
      } else {
        Animated.spring(translateX, { toValue:0, useNativeDriver:true, tension:80, friction:10 }).start();
      }
    },
  })).current;

  const resetSwipe = () =>
    Animated.spring(translateX, { toValue:0, useNativeDriver:true, tension:80, friction:10 }).start();

  const isIncome = item.type === 'income';

  return (
    <View style={{ marginBottom:10, borderRadius:16, overflow:'hidden' }}>
      <View style={sw.deleteBg}>
        <TouchableOpacity style={sw.deleteBgBtn} onPress={() => onDelete(item.id)}>
          <Text style={sw.deleteBgText}>Eliminar</Text>
        </TouchableOpacity>
      </View>
      <Animated.View {...panResponder.panHandlers} style={{ transform:[{ translateX }] }}>
        <TouchableOpacity activeOpacity={0.85} onPress={resetSwipe}>
          <View style={[s.card, { marginBottom:0 }, isIncome ? s.cardIncome : s.cardExpense]}>
            <View style={[s.typeIcon, isIncome ? s.typeIconIncome : s.typeIconExpense]}>
              <View style={[s.typeDot, { backgroundColor: isIncome ? C.income : C.expense }]} />
            </View>
            <View style={s.itemInfo}>
              <Text style={s.itemName} numberOfLines={1}>{item.description}</Text>
              <View style={s.itemMeta}>
                {/* Tap en el monto para editar */}
                <TouchableOpacity onPress={() => onEdit(item)} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
                  <Text style={[s.amountPrefix, isIncome ? s.amountIncome : s.amountExpense]}>
                    {isIncome ? '+' : '−'} {fmt(item.amount, currencySymbol)}
                  </Text>
                </TouchableOpacity>
                <Text style={s.itemDate}>{item.date}</Text>
              </View>
            </View>
            {/* Botón eliminar directo */}
            <TouchableOpacity
              onPress={() => onDelete(item.id)}
              hitSlop={{ top:8, bottom:8, left:8, right:8 }}
              style={sw.deleteBtn}
            >
              <Text style={sw.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const sw = StyleSheet.create({
  deleteBg:      { position:'absolute', top:0, right:0, bottom:0, backgroundColor:'rgba(224,112,112,0.2)', borderRadius:16, alignItems:'flex-end', justifyContent:'center', borderWidth:1, borderColor:'rgba(224,112,112,0.35)' },
  deleteBgBtn:   { width:80, alignItems:'center', justifyContent:'center', paddingVertical:12 },
  deleteBgText:  { fontSize:12, color:C.expense, fontWeight:'600' },
  deleteBtn:     { width:30, height:30, alignItems:'center', justifyContent:'center', borderRadius:15, backgroundColor:C.surface3 },
  deleteBtnText: { fontSize:14, color:C.text3, fontWeight:'600' },
});

// ═══════════════════════════════════════════
// MOVEMENT ROW (consultar movimientos)
// ═══════════════════════════════════════════
function MovementRowEditable({ item, onDelete, currencySymbol }) {
  const isIncome = item.type === 'income';
  return (
    <View style={acct.moveRow}>
      <View style={[acct.moveIcon, { backgroundColor: isIncome ? 'rgba(79,207,138,0.12)' : 'rgba(224,112,112,0.12)' }]}>
        <View style={[s.typeDot, { backgroundColor: isIncome ? C.income : C.expense }]} />
      </View>
      <View style={{ flex:1, minWidth:0 }}>
        <Text style={acct.moveName} numberOfLines={1}>{item.description}</Text>
      </View>
      <Text style={[acct.moveAmt, { color: isIncome ? C.income : C.expense }]}>
        {isIncome ? '+' : '−'} {fmt(item.amount, currencySymbol)}
      </Text>
      <TouchableOpacity style={acct.moveDelete} onPress={() => onDelete(item.id)} hitSlop={{ top:8, bottom:8, left:8, right:8 }}>
        <Text style={{ fontSize:13, color:C.text3 }}>✕</Text>
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

// ═══════════════════════════════════════════
// MINI BAR CHART
// ═══════════════════════════════════════════
function MiniBarChart({ groups, currencySymbol }) {
  if (!groups || groups.length === 0) return null;
  const maxVal  = Math.max(...groups.flatMap(g => [
    g.items.filter(m=>m.type==='income').reduce((s,m)=>s+m.amount,0),
    g.items.filter(m=>m.type==='expense').reduce((s,m)=>s+m.amount,0),
  ]), 1);
  const sliced = groups.slice(0,10).reverse();
  return (
    <View style={chart.container}>
      <Text style={chart.title}>Ingresos vs Gastos por día</Text>
      <View style={chart.barsArea}>
        {sliced.map(({ date, items }) => {
          const inc  = items.filter(m=>m.type==='income').reduce((s,m)=>s+m.amount,0);
          const exp  = items.filter(m=>m.type==='expense').reduce((s,m)=>s+m.amount,0);
          const inH  = Math.max((inc/maxVal)*80, inc>0?4:0);
          const exH  = Math.max((exp/maxVal)*80, exp>0?4:0);
          const dp   = date.split('/');
          const label= dp.length===3?`${dp[0]}/${dp[1]}`:date;
          return (
            <View key={date} style={chart.barGroup}>
              <View style={chart.barsWrap}>
                {inc>0 && <View style={[chart.bar,{height:inH,backgroundColor:C.income}]}/>}
                {exp>0 && <View style={[chart.bar,{height:exH,backgroundColor:C.expense}]}/>}
                {inc===0&&exp===0&&<View style={[chart.bar,{height:4,backgroundColor:C.surface3}]}/>}
              </View>
              <Text style={chart.barLabel}>{label}</Text>
            </View>
          );
        })}
      </View>
      <View style={chart.legend}>
        <View style={chart.legendItem}><View style={[chart.legendDot,{backgroundColor:C.income}]}/><Text style={chart.legendText}>Ingreso</Text></View>
        <View style={chart.legendItem}><View style={[chart.legendDot,{backgroundColor:C.expense}]}/><Text style={chart.legendText}>Gasto</Text></View>
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

// ═══════════════════════════════════════════
// APP INNER
// ═══════════════════════════════════════════
function AppInner() {
  const insets = useSafeAreaInsets();

  const [currentScreen, setCurrentScreen] = useState('main');

  // Listas
  const [lists,        setLists]        = useState([]);
  const [activeListId, setActiveListId] = useState(null);

  // Formulario
  const [description,       setDescription]       = useState('');
  const [amount,            setAmount]            = useState('');
  const [moveType,          setMoveType]          = useState('income');
  const [dateInput,         setDateInput]         = useState(todayStr());
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [formVisible,       setFormVisible]       = useState(true);

  // Filtro de consultar movimientos
  const [accountFilter, setAccountFilter] = useState('Mensual');
  const [searchQuery,   setSearchQuery]   = useState('');

  // Períodos finalizados expandidos
  const [expandedPeriod, setExpandedPeriod] = useState(null);

  // Editar monto de movimiento
  const [editMoveModal,   setEditMoveModal]   = useState(false);
  const [editingMove,     setEditingMove]     = useState(null);
  const [editMoveAmount,  setEditMoveAmount]  = useState('');

  // Modales
  const [drawerVisible,        setDrawerVisible]        = useState(false);
  const [listSelectorVisible,  setListSelectorVisible]  = useState(false);
  const [budgetModalVisible,   setBudgetModalVisible]   = useState(false);
  const [budgetInput,          setBudgetInput]          = useState('');
  const [pdfModalVisible,      setPdfModalVisible]      = useState(false);
  const [pdfTargetPeriod,      setPdfTargetPeriod]      = useState(null);
  const [finalizarVisible,     setFinalizarVisible]     = useState(false);
  const [saveModalVisible,     setSaveModalVisible]     = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [periodModalVisible,   setPeriodModalVisible]   = useState(false);
  const [clearListModal,       setClearListModal]       = useState(false);

  // Modal nueva/editar lista
  const [newListModal,    setNewListModal]    = useState(false);
  const [editListModal,   setEditListModal]   = useState(false);
  const [editingList,     setEditingList]     = useState(null);
  const [newListName,     setNewListName]     = useState('');
  const [newListColor,    setNewListColor]    = useState(LIST_COLORS[0]);
  const [newListCurrency, setNewListCurrency] = useState(CURRENCIES[0]);
  const [newListPeriod,   setNewListPeriod]   = useState('Mensual');
  const [deleteListModal, setDeleteListModal] = useState(false);
  const [listToDelete,    setListToDelete]    = useState(null);

  // Toast
  const [toastMsg,     setToastMsg]     = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastAnim = useRef(new Animated.Value(0)).current;

  // Animaciones
  const drawerAnim    = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const finalizarAnim = useRef(new Animated.Value(0)).current;
  const descInputRef  = useRef(null);
  const editingRef    = useRef(false);

  // ── Lista activa ──
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

  // ── Carga inicial ──
  useEffect(() => {
    (async () => {
      const savedLists  = await load(LISTS_KEY,  null);
      const savedActive = await load(ACTIVE_KEY, null);
      if (savedLists && savedLists.length > 0) {
        const migrated = savedLists.map(l => ({
          ...l,
          savedMovements: l.savedMovements || [],
          closedPeriods:  l.closedPeriods  || [],
        }));
        setLists(migrated);
        setActiveListId(savedActive || migrated[0].id);
        return;
      }
      const ml = createList({ name:'Mi presupuesto', color:LIST_COLORS[0], currency:CURRENCIES[0], period:'Mensual' });
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

  // ── Toast ──
  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    setToastVisible(true);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue:1, duration:280, useNativeDriver:true }),
      Animated.delay(2200),
      Animated.timing(toastAnim, { toValue:0, duration:280, useNativeDriver:true }),
    ]).start(() => setToastVisible(false));
  }, [toastAnim]);

  // ── Navegación ──
  const goToScreen = (screen) => {
    setCurrentScreen(screen);
    setSearchQuery('');
  };
  const goBack = () => { setCurrentScreen('main'); setSearchQuery(''); };

  // ── Drawer ──
  const openDrawer = () => {
    setDrawerVisible(true);
    Animated.spring(drawerAnim, { toValue:0, useNativeDriver:true, tension:60, friction:11 }).start();
  };
  const closeDrawer = (onDone) => {
    Animated.timing(drawerAnim, { toValue:-DRAWER_WIDTH, duration:240, useNativeDriver:true })
      .start(() => { setDrawerVisible(false); if (onDone) onDone(); });
  };

  // ── Modal finalizar ──
  const openFinalizarModal = () => {
    setFinalizarVisible(true);
    Animated.spring(finalizarAnim, { toValue:1, useNativeDriver:true, tension:70, friction:10 }).start();
  };
  const closeFinalizarModal = () => {
    Animated.spring(finalizarAnim, { toValue:0, useNativeDriver:true, tension:70, friction:10 })
      .start(() => setFinalizarVisible(false));
  };

  // ── Cálculos ──
  const movements      = activeList?.movements      || [];
  const savedMovements = activeList?.savedMovements || [];
  const closedPeriods  = activeList?.closedPeriods  || [];
  const period         = activeList?.period         || 'Mensual';
  const currency       = activeList?.currency       || CURRENCIES[0];
  const budget         = activeList?.budget         || 0;

  // Movimientos de la fecha seleccionada en el formulario
  const selectedDateMovements = movements.filter(m => m.date === dateInput);

  // Totales filtrados por período activo
  const movimientosFiltrados = movements.filter(m => isInFilter(m.date, period));
  const totalIngreso = movimientosFiltrados.filter(m=>m.type==='income').reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
  const totalGasto   = movimientosFiltrados.filter(m=>m.type==='expense').reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
  const totalBalance = totalIngreso - totalGasto;

  const budgetUsed   = budget > 0 ? Math.min(totalGasto/budget,1) : 0;
  const budgetRemain = budget > 0 ? budget - totalGasto : 0;
  const budgetOver   = budget > 0 && totalGasto > budget;
  const budgetWarn   = budget > 0 && budgetUsed > 0.85 && !budgetOver;

  // Consultar movimientos filtrado
  const filteredSaved = (() => {
    let filtered = savedMovements.filter(m => isInFilter(m.date, accountFilter));
    if (searchQuery.trim()) {
      filtered = filtered.filter(m =>
        m.description.toLowerCase().includes(searchQuery.trim().toLowerCase())
      );
    }
    return filtered;
  })();

  const accountGroups     = groupByDate(filteredSaved);
  const savedFilterIncome = filteredSaved.filter(m=>m.type==='income').reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
  const savedFilterExpense= filteredSaved.filter(m=>m.type==='expense').reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
  const savedFilterBalance= savedFilterIncome - savedFilterExpense;

  const savedMovementsCount = savedMovements.length;

  // ── CRUD Movimientos ──
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
    setDateInput(dateInput);
    Keyboard.dismiss();
    showToast(moveType==='income' ? 'Ingreso registrado' : 'Gasto registrado');
  };

  const deleteMovement = (id) =>
    updateActiveList(l => ({ movements: l.movements.filter(m => m.id !== id) }));

  const deleteSavedMovement = (id) =>
    updateActiveList(l => ({ savedMovements: l.savedMovements.filter(m => m.id !== id) }));

  // ── Editar monto ──
  const openEditMove = (move) => {
    setEditingMove(move);
    setEditMoveAmount(String(move.amount));
    setEditMoveModal(true);
  };

  const saveEditMove = () => {
    const amt = parseFloat(editMoveAmount);
    if (!amt || amt <= 0) { showToast('Ingresá un monto válido'); return; }
    updateActiveList(l => ({
      movements: l.movements.map(m =>
        m.id === editingMove.id ? { ...m, amount: amt } : m
      ),
    }));
    setEditMoveModal(false);
    showToast('Monto actualizado');
  };

  // ── Guardar movimientos ──
  const guardarMovimientos = () => {
    if (!movements.length) { showToast('No hay movimientos para guardar'); return; }
    setSaveModalVisible(true);
  };

  const confirmarGuardar = () => {
    updateActiveList(l => ({
      savedMovements: [...l.movements, ...l.savedMovements],
      movements:      [],
    }));
    setSaveModalVisible(false);
    showToast('Movimientos guardados');
  };

  // ── Finalizar período ──
  const finalizarPeriodo = () => {
    if (!savedMovements.length) { showToast('No hay movimientos guardados'); return; }
    openFinalizarModal();
  };

  const confirmarFinalizar = () => {
    const allSaved    = savedMovements;
    const incomeTotal = allSaved.filter(m=>m.type==='income').reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
    const expenseTotal= allSaved.filter(m=>m.type==='expense').reduce((s,m)=>s+(parseFloat(m.amount)||0),0);
    const session = {
      id:        Date.now().toString(),
      period,
      label:     `${period} — ${new Date().toLocaleDateString(getLocale(), { month:'long', year:'numeric' })}`,
      date:      new Date().toLocaleDateString(getLocale(), { day:'2-digit', month:'long', year:'numeric' }),
      ingreso:   incomeTotal,
      gasto:     expenseTotal,
      balance:   incomeTotal - expenseTotal,
      currency:  currency.symbol,
      movements: [...allSaved],
    };
    updateActiveList(l => ({
      closedPeriods:  [session, ...l.closedPeriods].slice(0, 24),
      savedMovements: [],
    }));
    closeFinalizarModal();
    showToast('Período finalizado');
  };

  // ── Presupuesto / Período / Moneda ──
  const saveBudget = () => {
    const val = parseFloat(budgetInput.replace(/[^\d.]/g,'')) || 0;
    updateActiveList(() => ({ budget: val }));
    setBudgetModalVisible(false);
    showToast(val > 0 ? `Presupuesto: ${fmt(val, currency.symbol)}` : 'Presupuesto desactivado');
  };

  const selectPeriod = (per) => {
    updateActiveList(() => ({ period: per }));
    setPeriodModalVisible(false);
    showToast(`Período: ${per}`);
  };

  const selectCurrency = (cur) => {
    updateActiveList(() => ({ currency: cur }));
    setCurrencyModalVisible(false);
    showToast(`Moneda: ${cur.symbol} ${cur.label}`);
  };

  // ── Gestión de listas ──
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
    showToast(`"${name}" creado`);
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
    showToast('Presupuesto actualizado');
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
    showToast('Presupuesto eliminado');
  };

  // ── PDF ──
  const buildPdfHtml = (movList, incTotal, expTotal, balTotal, label) => {
    const sym  = currency.symbol;
    const date = new Date().toLocaleDateString(getLocale(), { day:'2-digit', month:'long', year:'numeric' });
    const rows = movList.map(m => {
      const isInc = m.type === 'income';
      return `<tr>
        <td>${m.description}</td>
        <td style="text-align:center">${isInc ? 'Ingreso' : 'Gasto'}</td>
        <td style="text-align:right;color:${isInc ? '#2a9d5c' : '#c0392b'}">${isInc ? '+' : '−'} ${sym} ${Math.round(m.amount).toLocaleString(getLocale())}</td>
        <td>${m.date}</td>
      </tr>`;
    }).join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:Georgia,serif;margin:40px;color:#111}
  h1{font-size:28px;margin-bottom:4px;color:#1a2e5a}
  .sub{color:#666;font-size:14px;margin-bottom:24px}
  table{width:100%;border-collapse:collapse}
  th{background:#1a2e5a;color:#fff;padding:10px 12px;text-align:left;font-size:13px}
  td{padding:10px 12px;border-bottom:1px solid #eee;font-size:14px}
  .total-row td{font-weight:bold;font-size:15px;border-top:2px solid #1a2e5a;padding-top:14px}
  .income{color:#2a9d5c}.expense{color:#c0392b}
  .balance-pos{color:#2a9d5c;font-size:18px}.balance-neg{color:#c0392b;font-size:18px}
</style></head><body>
<h1>Mis Finanzas — ${activeList?.name || ''}</h1>
<div class="sub">${date} · ${label} · ${sym}</div>
<table><thead><tr><th>Descripción</th><th>Tipo</th><th>Monto</th><th>Fecha</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot>
  <tr class="total-row"><td colspan="2">TOTAL INGRESOS</td><td class="income">+ ${sym} ${Math.round(incTotal).toLocaleString(getLocale())}</td><td></td></tr>
  <tr class="total-row"><td colspan="2">TOTAL GASTOS</td><td class="expense">− ${sym} ${Math.round(expTotal).toLocaleString(getLocale())}</td><td></td></tr>
  <tr class="total-row"><td colspan="2">BALANCE</td><td class="${balTotal>=0?'balance-pos':'balance-neg'}">${balTotal>=0?'+':'−'} ${sym} ${Math.abs(Math.round(balTotal)).toLocaleString(getLocale())}</td><td></td></tr>
</tfoot></table></body></html>`;
  };

  const downloadPDF = async (movList, incTotal, expTotal, balTotal, label) => {
    setPdfModalVisible(false);
    try {
      const html = buildPdfHtml(movList, incTotal, expTotal, balTotal, label);
      const { uri } = await Print.printToFileAsync({ html });
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri, { mimeType:'application/pdf', dialogTitle:'Compartir reporte', UTI:'com.adobe.pdf' });
      } else { showToast('Compartir no disponible'); }
    } catch { showToast('Error al generar el PDF'); }
  };

  const downloadCSV = async (movList, incTotal, expTotal, balTotal) => {
    setPdfModalVisible(false);
    if (!movList.length) { showToast('No hay movimientos para exportar'); return; }
    try {
      const sym    = currency.symbol;
      const BOM    = '\uFEFF';
      const header = 'Descripcion,Tipo,Monto,Moneda,Fecha\n';
      const rows   = movList.map(m =>
        `"${m.description.replace(/"/g,'""')}","${m.type==='income'?'Ingreso':'Gasto'}",${m.amount},"${sym}","${m.date}"`
      ).join('\n');
      const totals =
        `\n"TOTAL INGRESOS","",${incTotal},"${sym}",""\n` +
        `"TOTAL GASTOS","",${expTotal},"${sym}",""\n` +
        `"BALANCE","",${incTotal-expTotal},"${sym}",""`;
      const csv     = BOM + header + rows + totals;
      const fileName= `mis-finanzas-${Date.now()}.csv`;
      const fileUri = FileSystem.cacheDirectory + fileName;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding:FileSystem.EncodingType.UTF8 });
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(fileUri, { mimeType:'text/csv', dialogTitle:'Guardar o compartir Excel', UTI:'public.comma-separated-values-text' });
      } else { showToast('Compartir no disponible'); }
    } catch { showToast('Error al exportar el archivo'); }
  };

  const shareText = async (movList, incTotal, expTotal, balTotal, label) => {
    if (!movList.length) { showToast('No hay movimientos para compartir'); return; }
    const sym  = currency.symbol;
    const text =
      `*${activeList?.name || 'Mis Finanzas'} — ${label}*\n\n` +
      movList.map(m =>
        `${m.type==='income'?'+ ':'− '}${m.description} · ${fmt(m.amount,sym)} · ${m.date}`
      ).join('\n') +
      `\n\nIngreso: ${fmt(incTotal,sym)}\nGasto: ${fmt(expTotal,sym)}\nBalance: ${balTotal>=0?'+':'−'} ${fmt(Math.abs(balTotal),sym)}`;
    try { await Share.share({ message: text }); }
    catch { showToast('No se pudo compartir'); }
  };

  const getPdfContext = () => {
    if (pdfTargetPeriod) {
      return {
        movList:  pdfTargetPeriod.movements,
        incTotal: pdfTargetPeriod.ingreso,
        expTotal: pdfTargetPeriod.gasto,
        balTotal: pdfTargetPeriod.balance,
        label:    pdfTargetPeriod.label,
      };
    }
    return {
      movList:  filteredSaved,
      incTotal: savedFilterIncome,
      expTotal: savedFilterExpense,
      balTotal: savedFilterBalance,
      label:    accountFilter,
    };
  };

  const BOTTOM_BAR_HEIGHT = 56 + Math.max(12, insets.bottom);

  // ══════════════════════════════════════════
  //  PANTALLA: CONSULTAR MOVIMIENTOS
  // ══════════════════════════════════════════
  if (currentScreen === 'account') {
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

        {/* Header */}
        <View style={[s.header, { paddingBottom:12 }]}>
          <View style={s.headerTop}>
            <TouchableOpacity
              style={s.btnBack}
              onPress={goBack}
              hitSlop={{ top:8, bottom:8, left:8, right:8 }}
            >
              <Text style={s.btnBackText}>Volver</Text>
            </TouchableOpacity>
            <View style={{ flex:1, paddingHorizontal:12 }}>
              <Text style={{ fontSize:16, fontWeight:'700', color:C.text }} numberOfLines={1}>
                Movimientos
              </Text>
              <Text style={{ fontSize:12, color:C.text3, marginTop:1 }}>
                {activeList?.name}
              </Text>
            </View>
            <TouchableOpacity
              style={s.btnIcon}
              onPress={() => { setPdfTargetPeriod(null); setPdfModalVisible(true); }}
              hitSlop={{ top:8, bottom:8, left:8, right:8 }}
            >
              <Text style={{ fontSize:13, color:C.text2 }}>PDF</Text>
            </TouchableOpacity>
          </View>

          {/* Filtro por período */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop:10 }}>
            <View style={{ flexDirection:'row', gap:8, paddingRight:8 }}>
              {PERIODS.map(p => (
                <TouchableOpacity
                  key={p}
                  style={[acctFilter.chip, accountFilter===p && acctFilter.chipActive]}
                  onPress={() => setAccountFilter(p)}
                >
                  <Text style={[acctFilter.chipText, accountFilter===p && acctFilter.chipTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Totales del filtro */}
          <View style={[s.totalsRow, { marginTop:10 }]}>
            <View style={[s.totalCard, s.totalCardIncome]}>
              <Text style={s.totalLabel}>Ingreso</Text>
              <Text style={[s.totalAmount, { color:C.income }]}>{fmt(savedFilterIncome, currency.symbol)}</Text>
            </View>
            <View style={[s.totalCard, s.totalCardExpense]}>
              <Text style={s.totalLabel}>Gasto</Text>
              <Text style={[s.totalAmount, { color:C.expense }]}>{fmt(savedFilterExpense, currency.symbol)}</Text>
            </View>
            <View style={[s.totalCard, s.totalCardBalance]}>
              <Text style={s.totalLabel}>Balance</Text>
              <Text style={[s.totalAmount, { color: savedFilterBalance>=0?C.income:C.expense }]}>
                {savedFilterBalance>=0?'+':'−'}{fmt(Math.abs(savedFilterBalance), currency.symbol)}
              </Text>
            </View>
          </View>
        </View>

        {/* Búsqueda */}
        <View style={s.searchSection}>
          <View style={s.searchWrap}>
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

          {/* Movimientos activos */}
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
              const isDayToday = isToday(date);
              return (
                <View key={date} style={[acctSection.container, isDayToday && acctSection.containerToday]}>
                  <View style={acctSection.dayHeader}>
                    <View style={{ flex:1 }}>
                      <Text style={[acctSection.dayTitle, isDayToday && { color:C.accent2 }]}>
                        {isDayToday ? 'Hoy — ' : ''}{formatDateFull(date)}
                      </Text>
                    </View>
                    <Text style={[acctSection.dayBalance, { color: dayBal>=0?C.income:C.expense }]}>
                      {dayBal>=0?'+':'−'}{fmt(Math.abs(dayBal), currency.symbol)}
                    </Text>
                  </View>
                  <View style={acctSection.divider} />
                  {items.map(item => (
                    <MovementRowEditable
                      key={item.id}
                      item={item}
                      onDelete={deleteSavedMovement}
                      currencySymbol={currency.symbol}
                    />
                  ))}
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

          {/* Total del filtro */}
          {accountGroups.length > 0 && (
            <View style={acctSection.periodTotal}>
              <Text style={acctSection.periodTotalLabel}>
                Total {accountFilter} · {filteredSaved.length} movimientos
              </Text>
              <Text style={[acctSection.periodTotalValue, { color: savedFilterBalance>=0?C.income:C.expense }]}>
                {savedFilterBalance>=0?'+':'−'} {fmt(Math.abs(savedFilterBalance), currency.symbol)}
              </Text>
            </View>
          )}

          {/* Períodos finalizados */}
          {closedPeriods.length > 0 && (
            <View style={{ marginTop:20 }}>
              <Text style={closedPeriodsStyle.sectionTitle}>Períodos finalizados</Text>
              {closedPeriods.map(session => {
                const isExpanded = expandedPeriod === session.id;
                const sym = session.currency || currency.symbol;
                return (
                  <View key={session.id} style={closedPeriodsStyle.card}>
                    <TouchableOpacity
                      style={closedPeriodsStyle.header}
                      onPress={() => setExpandedPeriod(isExpanded ? null : session.id)}
                    >
                      <View style={{ flex:1 }}>
                        <Text style={closedPeriodsStyle.label}>{session.label}</Text>
                        <Text style={closedPeriodsStyle.date}>{session.date} · {session.movements.length} movimientos</Text>
                      </View>
                      <View style={{ alignItems:'flex-end', gap:4 }}>
                        <Text style={[closedPeriodsStyle.balance, { color: session.balance>=0?C.income:C.expense }]}>
                          {session.balance>=0?'+':'−'} {fmt(Math.abs(session.balance),sym)}
                        </Text>
                        <Text style={closedPeriodsStyle.chevron}>{isExpanded ? 'Cerrar' : 'Ver detalle'}</Text>
                      </View>
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={closedPeriodsStyle.body}>
                        <View style={acctSection.divider} />
                        {session.movements.map((m,idx) => {
                          const isInc = m.type==='income';
                          return (
                            <View key={idx} style={acct.moveRow}>
                              <View style={[acct.moveIcon,{backgroundColor:isInc?'rgba(79,207,138,0.12)':'rgba(224,112,112,0.12)'}]}>
                                <View style={[s.typeDot,{backgroundColor:isInc?C.income:C.expense}]}/>
                              </View>
                              <Text style={[acct.moveName]} numberOfLines={1}>{m.description}</Text>
                              <Text style={[acct.moveAmt,{color:isInc?C.income:C.expense}]}>
                                {isInc?'+':'−'} {fmt(m.amount,sym)}
                              </Text>
                            </View>
                          );
                        })}
                        <View style={[acctSection.dayTotals,{marginTop:8}]}>
                          <Text style={[acctSection.dayTotalText,{color:C.income}]}>+{fmt(session.ingreso,sym)}</Text>
                          <Text style={[acctSection.dayTotalText,{color:C.expense}]}>−{fmt(session.gasto,sym)}</Text>
                        </View>
                        <View style={closedPeriodsStyle.actions}>
                          <TouchableOpacity
                            style={closedPeriodsStyle.actionBtn}
                            onPress={() => { setPdfTargetPeriod(session); setPdfModalVisible(true); }}
                          >
                            <Text style={closedPeriodsStyle.actionText}>PDF</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={closedPeriodsStyle.actionBtn}
                            onPress={() => downloadCSV(session.movements, session.ingreso, session.gasto, session.balance)}
                          >
                            <Text style={closedPeriodsStyle.actionText}>CSV</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={closedPeriodsStyle.actionBtn}
                            onPress={() => shareText(session.movements, session.ingreso, session.gasto, session.balance, session.label)}
                          >
                            <Text style={closedPeriodsStyle.actionText}>Compartir</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Bottom bar */}
        <View style={[s.bottomBar, { position:'absolute', bottom:0, left:0, right:0, paddingBottom: Math.max(12, insets.bottom) }]}>
          <TouchableOpacity style={s.btnBottom} onPress={() => { const ctx=getPdfContext(); shareText(ctx.movList,ctx.incTotal,ctx.expTotal,ctx.balTotal,ctx.label); }}>
            <Text style={s.btnBottomText}>Compartir</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.btnBottom, s.btnDanger]} onPress={finalizarPeriodo}>
            <Text style={[s.btnBottomText, { color:'#fff' }]}>Finalizar período</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnBottom} onPress={() => { const ctx=getPdfContext(); downloadCSV(ctx.movList,ctx.incTotal,ctx.expTotal,ctx.balTotal); }}>
            <Text style={s.btnBottomText}>CSV</Text>
          </TouchableOpacity>
        </View>

        {/* Modal PDF */}
        <Modal visible={pdfModalVisible} transparent animationType="slide" onRequestClose={() => setPdfModalVisible(false)}>
          <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setPdfModalVisible(false)}>
            <View style={[s.modalSheet, { paddingBottom: Math.max(40, insets.bottom+20) }]}>
              <View style={s.sheetHandle} />
              <Text style={s.sheetTitle}>Exportar reporte</Text>
              <Text style={s.sheetSub}>
                {pdfTargetPeriod ? pdfTargetPeriod.label : `${accountFilter} · ${filteredSaved.length} movimientos`}
              </Text>
              {(() => {
                const ctx = getPdfContext();
                return (<>
                  <TouchableOpacity style={s.pdfOption} onPress={() => downloadPDF(ctx.movList,ctx.incTotal,ctx.expTotal,ctx.balTotal,ctx.label)}>
                    <View style={s.pdfOptionIconBox}><Text style={s.pdfOptionIconText}>PDF</Text></View>
                    <View><Text style={s.pdfOptionTitle}>Descargar PDF</Text><Text style={s.pdfOptionSub}>Reporte con ingresos, gastos y balance</Text></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.pdfOption} onPress={() => downloadCSV(ctx.movList,ctx.incTotal,ctx.expTotal,ctx.balTotal)}>
                    <View style={s.pdfOptionIconBox}><Text style={s.pdfOptionIconText}>CSV</Text></View>
                    <View><Text style={s.pdfOptionTitle}>Descargar CSV</Text><Text style={s.pdfOptionSub}>Compatible con Excel y Google Sheets</Text></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.pdfOption} onPress={() => { setPdfModalVisible(false); shareText(ctx.movList,ctx.incTotal,ctx.expTotal,ctx.balTotal,ctx.label); }}>
                    <View style={s.pdfOptionIconBox}><Text style={s.pdfOptionIconText}>TXT</Text></View>
                    <View><Text style={s.pdfOptionTitle}>Compartir como texto</Text><Text style={s.pdfOptionSub}>Para WhatsApp, Telegram, etc.</Text></View>
                  </TouchableOpacity>
                </>);
              })()}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Modal Finalizar período */}
        <Modal visible={finalizarVisible} transparent animationType="none" onRequestClose={closeFinalizarModal}>
          <View style={s.finalizarOverlay}>
            <Animated.View style={[s.finalizarCard, {
              opacity: finalizarAnim,
              transform: [{ scale: finalizarAnim.interpolate({ inputRange:[0,1], outputRange:[0.85,1] }) }],
            }]}>
              <View style={s.finalizarHeader}>
                <Text style={s.finalizarTitle}>Finalizar período</Text>
              </View>
              <View style={s.finalizarContent}>
                <Text style={s.finalizarSub}>
                  Se cerrará el período y quedará guardado como referencia. Los movimientos actuales se archivarán.
                </Text>
                <View style={s.finalizarTotals}>
                  <View style={s.finalizarTotal}>
                    <Text style={s.finalizarTotalLabel}>Ingreso</Text>
                    <Text style={[s.finalizarTotalValue,{color:C.income}]}>{fmt(savedMovements.filter(m=>m.type==='income').reduce((s,m)=>s+m.amount,0),currency.symbol)}</Text>
                  </View>
                  <View style={s.finalizarDivider}/>
                  <View style={s.finalizarTotal}>
                    <Text style={s.finalizarTotalLabel}>Gasto</Text>
                    <Text style={[s.finalizarTotalValue,{color:C.expense}]}>{fmt(savedMovements.filter(m=>m.type==='expense').reduce((s,m)=>s+m.amount,0),currency.symbol)}</Text>
                  </View>
                  <View style={s.finalizarDivider}/>
                  <View style={s.finalizarTotal}>
                    <Text style={s.finalizarTotalLabel}>Balance</Text>
                    {(() => {
                      const inc=savedMovements.filter(m=>m.type==='income').reduce((s,m)=>s+m.amount,0);
                      const exp=savedMovements.filter(m=>m.type==='expense').reduce((s,m)=>s+m.amount,0);
                      const bal=inc-exp;
                      return <Text style={[s.finalizarTotalValue,{color:bal>=0?C.income:C.expense}]}>{bal>=0?'+':'−'}{fmt(Math.abs(bal),currency.symbol)}</Text>;
                    })()}
                  </View>
                </View>
              </View>
              <View style={s.finalizarActions}>
                <TouchableOpacity style={s.finalizarBtnCancel} onPress={closeFinalizarModal}>
                  <Text style={s.finalizarBtnCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.finalizarBtnConfirm} onPress={confirmarFinalizar}>
                  <Text style={s.finalizarBtnConfirmText}>Finalizar</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </Modal>

      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════
  //  PANTALLA: MAIN
  // ══════════════════════════════════════════
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

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* HEADER */}
        <View style={s.header}>
          <View style={s.headerTop}>
            <TouchableOpacity style={s.btnHamburger} onPress={openDrawer} hitSlop={{top:8,bottom:8,left:8,right:8}}>
              <View style={s.hamburgerLine}/>
              <View style={s.hamburgerLine}/>
              <View style={s.hamburgerLine}/>
            </TouchableOpacity>

            <TouchableOpacity style={s.listSelector} onPress={() => setListSelectorVisible(true)}>
              <View style={[s.listDot, { backgroundColor: activeList?.color || C.accent }]}/>
              <Text style={s.listSelectorName} numberOfLines={1}>{activeList?.name || 'Mi presupuesto'}</Text>
              <Text style={s.listSelectorChevron}>▾</Text>
            </TouchableOpacity>

            <View style={s.headerActions}>
              <TouchableOpacity style={s.btnCurrency} onPress={() => setCurrencyModalVisible(true)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                <Text style={s.btnCurrencyText}>{currency.symbol}</Text>
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
                {budget > 0 ? `Presupuesto: ${fmt(budget, currency.symbol)}` : 'Presupuesto'}
              </Text>
            </TouchableOpacity>
          </View>

          {budget > 0 && (
            <TouchableOpacity style={s.budgetBar} onPress={() => { setBudgetInput(String(budget)); setBudgetModalVisible(true); }}>
              <View style={s.budgetTrack}>
                <View style={[s.budgetFill, { width:`${Math.round(budgetUsed*100)}%` }, budgetOver&&{backgroundColor:C.expense}, budgetWarn&&{backgroundColor:C.warning}]}/>
              </View>
              <Text style={[s.budgetText, budgetOver&&{color:C.expense}, budgetWarn&&{color:C.warning}]}>
                {budgetOver
                  ? `Excedido por ${fmt(Math.abs(budgetRemain),currency.symbol)}`
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

        {/* FORMULARIO */}
        <View style={s.addSection}>
          {formVisible && (
            <>
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

              <Text style={s.fieldLabel}>Descripción</Text>
              <TextInput
                ref={descInputRef}
                style={s.input}
                placeholder="Ej: Salario, Supermercado..."
                placeholderTextColor={C.text3}
                value={description}
                onChangeText={setDescription}
                onSubmitEditing={addMovement}
                returnKeyType="done"
                blurOnSubmit={false}
              />

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
                    <Text style={{ color:C.text, fontSize:15 }}>{dateInput || todayStr()}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={[s.btnAdd, { backgroundColor: moveType==='income'?C.income:C.expense }]}
                onPress={addMovement}
              >
                <Text style={s.btnAddText}>
                  {moveType==='income' ? 'Agregar ingreso' : 'Agregar gasto'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={s.btnToggleForm}
            onPress={() => { setFormVisible(v=>!v); if (!formVisible) setTimeout(() => descInputRef.current?.focus(), 120); }}
          >
            <Text style={s.btnToggleFormText}>
              {formVisible ? 'Ocultar formulario' : 'Mostrar formulario'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* MOVIMIENTOS DE LA FECHA SELECCIONADA */}
        {selectedDateMovements.length > 0 && (
          <View style={todaySection.header}>
            <Text style={todaySection.title}>
              {dateInput === todayStr() ? 'Movimientos del día' : `Movimientos — ${dateInput}`}
            </Text>
          </View>
        )}

        <FlatList
          style={s.list}
          data={selectedDateMovements}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <SwipeableMovementRow
              item={item}
              onDelete={deleteMovement}
              onEdit={openEditMove}
              currencySymbol={currency.symbol}
            />
          )}
          contentContainerStyle={[s.listContent, { paddingBottom: BOTTOM_BAR_HEIGHT }]}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => { Keyboard.dismiss(); editingRef.current = false; setFormVisible(false); }}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyEmoji}>💸</Text>
              <Text style={s.emptyText}>
                {dateInput === todayStr() ? 'Sin movimientos hoy' : `Sin movimientos el ${dateInput}`}
              </Text>
              <Text style={s.emptySmall}>Registrá ingresos y gastos arriba</Text>
            </View>
          }
        />
      </KeyboardAvoidingView>

      {/* BOTTOM BAR */}
      <View style={[s.bottomBar, { position:'absolute', bottom:0, left:0, right:0, paddingBottom: Math.max(12, insets.bottom) }]}>
        <TouchableOpacity style={s.btnBottom} onPress={() => { closeDrawer(); goToScreen('account'); }}>
          <Text style={s.btnBottomText}>
            Ver movimientos{savedMovementsCount > 0 ? ` (${savedMovementsCount})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btnBottom, s.btnPrimary]} onPress={guardarMovimientos}>
          <Text style={[s.btnBottomText, { color:C.bg }]}>Guardar movimientos</Text>
        </TouchableOpacity>
      </View>

      {/* MODAL EDITAR MONTO */}
      <Modal visible={editMoveModal} transparent animationType="fade" onRequestClose={() => setEditMoveModal(false)}>
        <View style={s.finalizarOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setEditMoveModal(false)} activeOpacity={1}/>
          <View style={s.finalizarCard}>
            <View style={s.finalizarHeader}>
              <Text style={s.finalizarTitle}>Editar monto</Text>
            </View>
            <View style={s.finalizarContent}>
              <Text style={s.finalizarSub} numberOfLines={1}>{editingMove?.description}</Text>
              <TextInput
                style={[s.input, { fontSize:22, textAlign:'center', marginTop:8 }]}
                value={editMoveAmount}
                onChangeText={setEditMoveAmount}
                keyboardType="numeric"
                selectTextOnFocus
                autoFocus
                returnKeyType="done"
                onSubmitEditing={saveEditMove}
              />
            </View>
            <View style={s.finalizarActions}>
              <TouchableOpacity style={s.finalizarBtnCancel} onPress={() => setEditMoveModal(false)}>
                <Text style={s.finalizarBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.finalizarBtnConfirm} onPress={saveEditMove}>
                <Text style={s.finalizarBtnConfirmText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL GUARDAR */}
      <Modal visible={saveModalVisible} transparent animationType="fade" onRequestClose={() => setSaveModalVisible(false)}>
        <View style={s.finalizarOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setSaveModalVisible(false)} activeOpacity={1}/>
          <View style={s.finalizarCard}>
            <View style={s.finalizarHeader}>
              <Text style={s.finalizarTitle}>Guardar movimientos</Text>
            </View>
            <View style={s.finalizarContent}>
              <Text style={s.finalizarSub}>
                Se guardarán {movements.length} movimiento{movements.length!==1?'s':''} en "Consultar movimientos" y se limpiará la pantalla principal.
              </Text>
              <View style={s.finalizarTotals}>
                <View style={s.finalizarTotal}>
                  <Text style={s.finalizarTotalLabel}>Ingreso</Text>
                  <Text style={[s.finalizarTotalValue,{color:C.income}]}>{fmt(totalIngreso,currency.symbol)}</Text>
                </View>
                <View style={s.finalizarDivider}/>
                <View style={s.finalizarTotal}>
                  <Text style={s.finalizarTotalLabel}>Gasto</Text>
                  <Text style={[s.finalizarTotalValue,{color:C.expense}]}>{fmt(totalGasto,currency.symbol)}</Text>
                </View>
                <View style={s.finalizarDivider}/>
                <View style={s.finalizarTotal}>
                  <Text style={s.finalizarTotalLabel}>Balance</Text>
                  <Text style={[s.finalizarTotalValue,{color:totalBalance>=0?C.income:C.expense}]}>
                    {totalBalance>=0?'+':'−'}{fmt(Math.abs(totalBalance),currency.symbol)}
                  </Text>
                </View>
              </View>
            </View>
            <View style={s.finalizarActions}>
              <TouchableOpacity style={s.finalizarBtnCancel} onPress={() => setSaveModalVisible(false)}>
                <Text style={s.finalizarBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.finalizarBtnConfirm} onPress={confirmarGuardar}>
                <Text style={s.finalizarBtnConfirmText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* DRAWER */}
      <Modal visible={drawerVisible} transparent animationType="none" onRequestClose={() => closeDrawer()}>
        <View style={s.drawerOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => closeDrawer()} activeOpacity={1}/>
          <Animated.View style={[s.drawerPanel, { transform:[{ translateX: drawerAnim }] }]}>
            <SafeAreaView edges={['top','left','bottom']} style={s.drawerSafe}>
              <View style={s.drawerHeader}>
                <Text style={s.drawerTitle}>Mis Finanzas</Text>
                <TouchableOpacity onPress={() => closeDrawer()} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                  <Text style={s.drawerClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex:1 }} showsVerticalScrollIndicator={false}>
                <View style={{ paddingHorizontal:16, paddingTop:16 }}>
                  <TouchableOpacity
                    style={drawerMini.consultBtn}
                    onPress={() => closeDrawer(() => setTimeout(() => goToScreen('account'), 260))}
                  >
                    <Text style={drawerMini.consultBtnText}>Consultar movimientos</Text>
                    {savedMovementsCount > 0 && (
                      <View style={drawerMini.badge}>
                        <Text style={drawerMini.badgeText}>{savedMovementsCount}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                <View style={s.drawerSection}>
                  <Text style={s.drawerSectionTitle}>MIS PRESUPUESTOS</Text>
                  {lists.map(list => (
                    <TouchableOpacity key={list.id} style={[s.drawerItem,{marginBottom:8},list.id===activeListId&&{borderColor:list.color}]}
                      onPress={() => { switchList(list.id); closeDrawer(); }}>
                      <View style={[s.listDot,{backgroundColor:list.color,marginRight:10}]}/>
                      <View style={{ flex:1 }}>
                        <Text style={s.drawerItemText}>{list.name}</Text>
                        <Text style={s.drawerItemSub}>{list.currency.symbol} · {list.period}{list.budget>0?` · ${fmt(list.budget,list.currency.symbol)}`:''}</Text>
                      </View>
                      <View style={{ flexDirection:'row', alignItems:'center', gap:10 }}>
                        {list.id===activeListId && <Text style={[s.drawerChevron,{color:list.color}]}>✓</Text>}
                        <TouchableOpacity style={s.listItemEditBtn} onPress={() => { setListSelectorVisible(false); openEditList(list); }} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                          <Text style={s.listItemEditText}>✎</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  ))}
                  {lists.length < MAX_LISTS && (
                    <TouchableOpacity style={s.drawerNewListBtn} onPress={() => closeDrawer(() => openNewListModal())}>
                      <Text style={s.drawerNewListText}>Nuevo presupuesto</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </ScrollView>
            </SafeAreaView>
          </Animated.View>
        </View>
      </Modal>

      {/* MODAL SELECTOR LISTA */}
      <Modal visible={listSelectorVisible} transparent animationType="slide" onRequestClose={() => setListSelectorVisible(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setListSelectorVisible(false)}>
          <View style={[s.modalSheet,{paddingBottom:Math.max(40,insets.bottom+20)}]}>
            <View style={s.sheetHandle}/>
            <Text style={s.sheetTitle}>Mis presupuestos</Text>
            <Text style={s.sheetSub}>Seleccioná o creá uno nuevo</Text>
            {lists.map(list => (
              <TouchableOpacity key={list.id} style={[s.listItem,list.id===activeListId&&{borderColor:list.color}]} onPress={() => switchList(list.id)}>
                <View style={[s.listItemDot,{backgroundColor:list.color}]}/>
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
                <Text style={s.btnNewListText}>Nuevo presupuesto</Text>
              </TouchableOpacity>
            )}
            {lists.length >= MAX_LISTS && <Text style={s.maxListsNote}>Máximo {MAX_LISTS} presupuestos alcanzado</Text>}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MODAL NUEVA LISTA */}
      <Modal visible={newListModal} transparent animationType="slide" onRequestClose={() => setNewListModal(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setNewListModal(false)}>
          <View style={[s.modalSheet,{paddingBottom:Math.max(40,insets.bottom+20)}]} onStartShouldSetResponder={() => true}>
            <View style={s.sheetHandle}/>
            <Text style={s.sheetTitle}>Nuevo presupuesto</Text>
            <Text style={s.fieldLabel}>Nombre</Text>
            <TextInput style={[s.input,{marginBottom:16}]} placeholder="Ej: Salario, Freelance..." placeholderTextColor={C.text3} value={newListName} onChangeText={setNewListName} autoFocus returnKeyType="done"/>
            <Text style={s.fieldLabel}>Color</Text>
            <View style={s.colorRow}>
              {LIST_COLORS.map(color => (
                <TouchableOpacity key={color} style={[s.colorDot,{backgroundColor:color},newListColor===color&&s.colorDotSelected]} onPress={() => setNewListColor(color)}/>
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
              <Text style={[s.btnAddText,{color:'#fff'}]}>Crear presupuesto</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MODAL EDITAR LISTA */}
      <Modal visible={editListModal} transparent animationType="slide" onRequestClose={() => setEditListModal(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setEditListModal(false)}>
          <View style={[s.modalSheet,{paddingBottom:Math.max(40,insets.bottom+20)}]} onStartShouldSetResponder={() => true}>
            <View style={s.sheetHandle}/>
            <Text style={s.sheetTitle}>Editar presupuesto</Text>
            <Text style={s.fieldLabel}>Nombre</Text>
            <TextInput style={[s.input,{marginBottom:16}]} placeholder="Nombre del presupuesto" placeholderTextColor={C.text3} value={newListName} onChangeText={setNewListName} autoFocus returnKeyType="done"/>
            <Text style={s.fieldLabel}>Color</Text>
            <View style={[s.colorRow,{marginBottom:20}]}>
              {LIST_COLORS.map(color => (
                <TouchableOpacity key={color} style={[s.colorDot,{backgroundColor:color},newListColor===color&&s.colorDotSelected]} onPress={() => setNewListColor(color)}/>
              ))}
            </View>
            <TouchableOpacity style={s.btnAdd} onPress={confirmEditList}>
              <Text style={[s.btnAddText,{color:'#fff'}]}>Guardar cambios</Text>
            </TouchableOpacity>
            {lists.length > 1 && (
              <TouchableOpacity style={[s.btnAdd,{backgroundColor:'transparent',borderWidth:1,borderColor:C.expense,marginTop:10}]}
                onPress={() => { setListToDelete(editingList); setEditListModal(false); setDeleteListModal(true); }}>
                <Text style={[s.btnAddText,{color:C.expense}]}>Eliminar presupuesto</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MODAL ELIMINAR LISTA */}
      <Modal visible={deleteListModal} transparent animationType="fade" onRequestClose={() => setDeleteListModal(false)}>
        <View style={s.finalizarOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setDeleteListModal(false)} activeOpacity={1}/>
          <View style={s.finalizarCard}>
            <View style={s.finalizarHeader}><Text style={s.finalizarTitle}>Eliminar presupuesto</Text></View>
            <View style={s.finalizarContent}>
              <Text style={s.finalizarSub}>¿Eliminar "{listToDelete?.name}"? Se borrarán todos sus movimientos. Esta acción no se puede deshacer.</Text>
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

      {/* MODAL PERÍODO */}
      <Modal visible={periodModalVisible} transparent animationType="slide" onRequestClose={() => setPeriodModalVisible(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setPeriodModalVisible(false)}>
          <View style={[s.modalSheet,{paddingBottom:Math.max(40,insets.bottom+20)}]}>
            <View style={s.sheetHandle}/>
            <Text style={s.sheetTitle}>Seleccionar período</Text>
            <Text style={s.sheetSub}>Afecta el presupuesto y los totales del header</Text>
            {PERIODS.map(p => (
              <TouchableOpacity key={p} style={[s.pdfOption,period===p&&{borderColor:C.accent}]} onPress={() => selectPeriod(p)}>
                <View style={s.pdfOptionIconBox}><Text style={s.pdfOptionIconText}>{p.slice(0,3).toUpperCase()}</Text></View>
                <View style={{ flex:1 }}>
                  <Text style={s.pdfOptionTitle}>{p}</Text>
                  <Text style={s.pdfOptionSub}>{p==='Diario'?'Solo hoy':p==='Semanal'?'Lunes a domingo':p==='Quincenal'?'1–15 o 16–fin de mes':'Este mes calendario'}</Text>
                </View>
                {period===p && <Text style={{color:C.accent,fontSize:20}}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MODAL MONEDA */}
      <Modal visible={currencyModalVisible} transparent animationType="slide" onRequestClose={() => setCurrencyModalVisible(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setCurrencyModalVisible(false)}>
          <View style={[s.modalSheet,{paddingBottom:Math.max(40,insets.bottom+20)}]}>
            <View style={s.sheetHandle}/>
            <Text style={s.sheetTitle}>Moneda — {activeList?.name}</Text>
            <Text style={s.sheetSub}>Solo aplica a este presupuesto</Text>
            {CURRENCIES.map(cur => (
              <TouchableOpacity key={cur.code} style={[s.pdfOption,currency.code===cur.code&&{borderColor:C.accent}]} onPress={() => selectCurrency(cur)}>
                <View style={s.pdfOptionIconBox}><Text style={s.pdfOptionIconText}>{cur.symbol}</Text></View>
                <View><Text style={s.pdfOptionTitle}>{cur.label}</Text><Text style={s.pdfOptionSub}>{cur.code}</Text></View>
                {currency.code===cur.code && <Text style={{marginLeft:'auto',color:C.accent,fontSize:20}}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MODAL PRESUPUESTO */}
      <Modal visible={budgetModalVisible} transparent animationType="fade" onRequestClose={() => setBudgetModalVisible(false)}>
        <TouchableOpacity style={[s.budgetOverlay,{paddingTop:insets.top+70}]} activeOpacity={1} onPress={() => setBudgetModalVisible(false)}>
          <View style={s.budgetCard} onStartShouldSetResponder={() => true}>
            <Text style={s.budgetCardTitle}>Presupuesto — {activeList?.name}</Text>
            <Text style={s.budgetCardSub}>La app te avisará cuando estés cerca de superarlo</Text>
            <TextInput style={[s.input,{marginBottom:20,fontSize:22}]} placeholder="Ej: 50000" placeholderTextColor={C.text3} value={budgetInput} onChangeText={setBudgetInput} keyboardType="numeric" selectTextOnFocus autoFocus/>
            <View style={s.budgetBtnRow}>
              <TouchableOpacity style={s.budgetBtnSave} onPress={saveBudget}>
                <Text style={s.budgetBtnSaveText}>Guardar</Text>
              </TouchableOpacity>
              {budget > 0 ? (
                <TouchableOpacity style={s.budgetBtnDeactivate} onPress={() => { updateActiveList(()=>({budget:0})); setBudgetModalVisible(false); showToast('Presupuesto desactivado'); }}>
                  <Text style={s.budgetBtnDeactivateText}>Desactivar</Text>
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

      {/* MODAL LIMPIAR */}
      <Modal visible={clearListModal} transparent animationType="fade" onRequestClose={() => setClearListModal(false)}>
        <View style={s.finalizarOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setClearListModal(false)} activeOpacity={1}/>
          <View style={s.finalizarCard}>
            <View style={s.finalizarHeader}><Text style={s.finalizarTitle}>Limpiar movimientos</Text></View>
            <View style={s.finalizarContent}>
              <Text style={s.finalizarSub}>¿Borrar todos los movimientos de "{activeList?.name}"? Esta acción no se puede deshacer.</Text>
            </View>
            <View style={s.finalizarActions}>
              <TouchableOpacity style={s.finalizarBtnCancel} onPress={() => setClearListModal(false)}>
                <Text style={s.finalizarBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.finalizarBtnConfirm,{backgroundColor:C.expense,borderColor:C.expense}]}
                onPress={() => { updateActiveList(()=>({movements:[]})); setClearListModal(false); showToast('Movimientos eliminados'); }}>
                <Text style={s.finalizarBtnConfirmText}>Limpiar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* CALENDAR */}
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

// ─── ESTILOS ──────────────────────────────
const todaySection = StyleSheet.create({
  header: { paddingHorizontal:16, paddingTop:12, paddingBottom:4, backgroundColor:C.bg },
  title:  { fontSize:12, fontWeight:'700', color:C.text3, letterSpacing:0.8, textTransform:'uppercase' },
});

const acctFilter = StyleSheet.create({
  chip:          { paddingVertical:7, paddingHorizontal:16, borderRadius:20, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2 },
  chipActive:    { borderColor:C.accent, backgroundColor:C.accentGlow },
  chipText:      { fontSize:13, color:C.text3, fontWeight:'500' },
  chipTextActive:{ color:C.accent2, fontWeight:'700' },
});

const acctSection = StyleSheet.create({
  container:        { backgroundColor:C.surface, borderRadius:16, borderWidth:1, borderColor:C.border, marginBottom:14, padding:14 },
  containerToday:   { borderColor:C.accent, backgroundColor:'rgba(79,142,247,0.06)' },
  dayHeader:        { flexDirection:'row', alignItems:'center', marginBottom:6 },
  dayTitle:         { fontSize:14, fontWeight:'700', color:C.text2 },
  dayBalance:       { fontSize:15, fontWeight:'700', marginLeft:8 },
  divider:          { height:1, backgroundColor:C.border, marginBottom:8 },
  dayTotals:        { flexDirection:'row', justifyContent:'flex-end', gap:14, paddingTop:8, marginTop:4, borderTopWidth:1, borderTopColor:C.border },
  dayTotalText:     { fontSize:12, fontWeight:'600' },
  periodTotal:      { backgroundColor:C.surface, borderRadius:12, borderWidth:1, borderColor:C.accent, padding:16, alignItems:'center', gap:4 },
  periodTotalLabel: { fontSize:12, color:C.text3, fontWeight:'500' },
  periodTotalValue: { fontSize:20, fontWeight:'700' },
});

const closedPeriodsStyle = StyleSheet.create({
  sectionTitle: { fontSize:11, fontWeight:'700', color:C.text3, letterSpacing:1, textTransform:'uppercase', marginBottom:12 },
  card:         { backgroundColor:C.surface, borderRadius:16, borderWidth:1, borderColor:C.border, marginBottom:12, overflow:'hidden' },
  header:       { flexDirection:'row', alignItems:'center', padding:14 },
  label:        { fontSize:14, fontWeight:'700', color:C.text },
  date:         { fontSize:12, color:C.text3, marginTop:2 },
  balance:      { fontSize:15, fontWeight:'700' },
  chevron:      { fontSize:11, color:C.accent, fontWeight:'600' },
  body:         { paddingHorizontal:14, paddingBottom:14 },
  actions:      { flexDirection:'row', gap:8, marginTop:12 },
  actionBtn:    { flex:1, paddingVertical:10, borderRadius:10, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center' },
  actionText:   { fontSize:13, fontWeight:'600', color:C.text2 },
});

const drawerMini = StyleSheet.create({
  consultBtn:     { backgroundColor:C.accentGlow, borderWidth:1, borderColor:C.accent, borderRadius:12, paddingVertical:14, paddingHorizontal:14, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 },
  consultBtnText: { fontSize:14, fontWeight:'700', color:C.accent2 },
  badge:          { backgroundColor:C.accent, borderRadius:99, minWidth:22, height:22, alignItems:'center', justifyContent:'center', paddingHorizontal:6 },
  badgeText:      { fontSize:12, fontWeight:'700', color:'#fff' },
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

  header:        { backgroundColor:C.surface, paddingHorizontal:16, paddingTop:12, paddingBottom:10, borderBottomWidth:1, borderBottomColor:C.border, gap:10 },
  headerTop:     { flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  headerActions: { flexDirection:'row', gap:8 },

  btnBack:     { paddingVertical:8, paddingHorizontal:12, borderRadius:10, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2 },
  btnBackText: { fontSize:13, fontWeight:'600', color:C.text2 },

  btnIcon:      { paddingVertical:8, paddingHorizontal:12, borderRadius:10, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center', justifyContent:'center' },
  btnHamburger: { width:38, height:38, borderRadius:19, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center', justifyContent:'center', gap:4, paddingVertical:8 },
  hamburgerLine:{ width:16, height:2, borderRadius:1, backgroundColor:C.text2 },

  listSelector:       { flex:1, flexDirection:'row', alignItems:'center', gap:8, marginHorizontal:10, paddingVertical:6, paddingHorizontal:12, borderRadius:20, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2 },
  listDot:            { width:10, height:10, borderRadius:5 },
  listSelectorName:   { flex:1, fontSize:15, fontWeight:'700', color:C.text },
  listSelectorChevron:{ fontSize:12, color:C.text3 },

  btnCurrency:    { width:38, height:38, borderRadius:19, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center', justifyContent:'center' },
  btnCurrencyText:{ fontSize:15, fontWeight:'700', color:C.accent2 },

  periodSelectorRow:    { flexDirection:'row', gap:8, alignItems:'center' },
  periodSelectorBtn:    { flexDirection:'row', alignItems:'center', gap:6, paddingVertical:7, paddingHorizontal:14, borderRadius:20, borderWidth:1, borderColor:C.accent, backgroundColor:C.accentGlow },
  periodSelectorText:   { fontSize:13, color:C.accent2, fontWeight:'600' },
  periodSelectorChevron:{ fontSize:12, color:C.accent2 },
  btnBudgetConfig:      { flexDirection:'row', alignItems:'center', paddingVertical:7, paddingHorizontal:14, borderRadius:20, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, flex:1 },
  btnBudgetConfigText:  { fontSize:12, color:C.text2, fontWeight:'500', flex:1, textAlign:'center' },

  budgetBar:   { gap:4 },
  budgetTrack: { height:4, backgroundColor:C.surface3, borderRadius:2, overflow:'hidden' },
  budgetFill:  { height:'100%', backgroundColor:C.accent, borderRadius:2 },
  budgetText:  { fontSize:11, color:C.text3 },

  totalsRow:        { flexDirection:'row', gap:6 },
  totalCard:        { flex:1, backgroundColor:C.surface2, borderRadius:10, paddingVertical:8, paddingHorizontal:10, borderWidth:1, borderColor:C.border },
  totalCardIncome:  { borderColor:'rgba(79,207,138,0.25)' },
  totalCardExpense: { borderColor:'rgba(224,112,112,0.25)' },
  totalCardBalance: { borderColor:'rgba(79,142,247,0.3)' },
  totalLabel:  { fontSize:9, color:C.text3, fontWeight:'500', letterSpacing:0.5, textTransform:'uppercase' },
  totalAmount: { fontSize:13, fontWeight:'700', color:C.accent, marginTop:2 },

  addSection: { paddingHorizontal:16, paddingVertical:12, backgroundColor:C.surface, borderBottomWidth:1, borderBottomColor:C.border, gap:10 },
  inputGroup: { flexDirection:'row', gap:8 },
  fieldWrap:  { flex:1, gap:4 },
  fieldLabel: { fontSize:11, color:C.text3, fontWeight:'500', letterSpacing:0.5, textTransform:'uppercase', marginBottom:2 },
  input:      { backgroundColor:C.surface2, borderWidth:1, borderColor:C.border, borderRadius:10, color:C.text, fontSize:15, paddingVertical:11, paddingHorizontal:14 },
  btnAdd:     { borderRadius:10, paddingVertical:13, alignItems:'center', justifyContent:'center', backgroundColor:C.accent },
  btnAddText: { color:'#fff', fontSize:15, fontWeight:'700', letterSpacing:0.3 },

  toggleRow:                  { flexDirection:'row', gap:8 },
  toggleBtn:                  { flex:1, paddingVertical:10, borderRadius:10, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center', justifyContent:'center' },
  toggleBtnIncomeActive:      { backgroundColor:'rgba(79,207,138,0.18)', borderColor:C.income },
  toggleBtnExpenseActive:     { backgroundColor:'rgba(224,112,112,0.18)', borderColor:C.expense },
  toggleBtnText:              { fontSize:14, fontWeight:'600', color:C.text3 },
  toggleBtnTextActiveIncome:  { color:C.income },
  toggleBtnTextActiveExpense: { color:C.expense },

  searchSection: { paddingHorizontal:16, paddingTop:10, paddingBottom:4, backgroundColor:C.bg },
  searchWrap:    { flexDirection:'row', alignItems:'center', position:'relative' },
  searchInput:   { flex:1, backgroundColor:C.surface, borderWidth:1, borderColor:C.border, borderRadius:10, color:C.text, fontSize:15, paddingVertical:11, paddingLeft:16, paddingRight:40 },
  searchClear:   { position:'absolute', right:12, width:22, height:22, borderRadius:11, backgroundColor:C.surface3, alignItems:'center', justifyContent:'center', zIndex:1 },
  searchClearText:{ color:C.text3, fontSize:14, fontWeight:'700', lineHeight:22 },

  list:        { flex:1 },
  listContent: { padding:12, paddingBottom:16 },
  emptyState:  { alignItems:'center', paddingVertical:60, paddingHorizontal:20 },
  emptyEmoji:  { fontSize:56, marginBottom:16 },
  emptyText:   { fontSize:18, fontStyle:'italic', color:C.text2, textAlign:'center' },
  emptySmall:  { fontSize:14, color:C.text3, marginTop:8, textAlign:'center' },

  card:            { backgroundColor:C.surface, borderWidth:1, borderColor:C.border, borderRadius:16, marginBottom:10, padding:14, flexDirection:'row', alignItems:'center', gap:12 },
  cardIncome:      { borderLeftWidth:3, borderLeftColor:C.income },
  cardExpense:     { borderLeftWidth:3, borderLeftColor:C.expense },
  typeIcon:        { width:32, height:32, borderRadius:16, alignItems:'center', justifyContent:'center' },
  typeIconIncome:  { backgroundColor:'rgba(79,207,138,0.15)' },
  typeIconExpense: { backgroundColor:'rgba(224,112,112,0.15)' },
  typeDot:         { width:10, height:10, borderRadius:5 },
  itemInfo:        { flex:1, minWidth:0 },
  itemName:        { fontSize:15, fontWeight:'500', color:C.text },
  itemMeta:        { flexDirection:'row', alignItems:'center', gap:8, marginTop:4, flexWrap:'wrap' },
  amountIncome:    { color:C.income },
  amountExpense:   { color:C.expense },
  amountPrefix:    { fontSize:14, fontWeight:'700' },
  itemDate:        { fontSize:12, color:C.text3 },

  bottomBar:    { backgroundColor:C.surface, borderTopWidth:1, borderTopColor:C.border, paddingHorizontal:16, paddingTop:12, flexDirection:'row', gap:8 },
  btnBottom:    { flex:1, paddingVertical:13, paddingHorizontal:8, borderRadius:10, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center', justifyContent:'center' },
  btnPrimary:   { backgroundColor:C.accent, borderColor:C.accent },
  btnDanger:    { backgroundColor:'rgba(224,112,112,0.85)', borderColor:C.expense },
  btnBottomText:{ fontSize:13, fontWeight:'600', color:C.text2 },

  toast:     { position:'absolute', alignSelf:'center', backgroundColor:C.accent, paddingVertical:10, paddingHorizontal:20, borderRadius:99, zIndex:999 },
  toastText: { color:'#fff', fontSize:14, fontWeight:'700' },

  drawerOverlay: { flex:1, flexDirection:'row' },
  drawerPanel:   { width:DRAWER_WIDTH, backgroundColor:C.drawerBg, borderRightWidth:1, borderRightColor:C.border, shadowColor:'#000', shadowOffset:{width:8,height:0}, shadowOpacity:0.5, shadowRadius:16, elevation:24 },
  drawerSafe:    { flex:1 },
  drawerHeader:  { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:20, paddingVertical:16, borderBottomWidth:1, borderBottomColor:C.border },
  drawerTitle:   { fontSize:20, fontWeight:'700', color:C.accent2 },
  drawerClose:   { fontSize:20, color:C.text3 },
  drawerSection: { paddingHorizontal:16, paddingTop:20, paddingBottom:8 },
  drawerSectionTitle: { fontSize:11, color:C.text3, fontWeight:'700', letterSpacing:1, textTransform:'uppercase', marginBottom:12 },
  drawerItem:    { flexDirection:'row', alignItems:'center', paddingVertical:14, paddingHorizontal:14, backgroundColor:C.surface2, borderRadius:12, borderWidth:1, borderColor:C.border },
  drawerItemText:{ fontSize:15, fontWeight:'600', color:C.text },
  drawerItemSub: { fontSize:12, color:C.text3, marginTop:2 },
  drawerChevron: { fontSize:20, color:C.text3 },
  drawerNewListBtn: { marginTop:8, paddingVertical:12, borderRadius:12, borderWidth:1, borderColor:C.accent, borderStyle:'dashed', alignItems:'center', backgroundColor:C.accentGlow },
  drawerNewListText:{ color:C.accent, fontSize:14, fontWeight:'600' },

  listItem:        { flexDirection:'row', alignItems:'center', paddingVertical:14, paddingHorizontal:14, backgroundColor:C.surface2, borderRadius:12, borderWidth:1, borderColor:C.border, marginBottom:10 },
  listItemDot:     { width:12, height:12, borderRadius:6, marginRight:12 },
  listItemName:    { fontSize:15, fontWeight:'600', color:C.text },
  listItemSub:     { fontSize:12, color:C.text3, marginTop:2 },
  listItemActions: { flexDirection:'row', alignItems:'center', gap:10 },
  listItemCheck:   { fontSize:18, fontWeight:'700' },
  listItemEditBtn: { width:30, height:30, alignItems:'center', justifyContent:'center' },
  listItemEditText:{ fontSize:16, color:C.text3 },
  btnNewList:      { paddingVertical:14, borderRadius:12, borderWidth:1, borderColor:C.accent, borderStyle:'dashed', alignItems:'center', backgroundColor:C.accentGlow, marginTop:4 },
  btnNewListText:  { color:C.accent, fontSize:15, fontWeight:'600' },
  maxListsNote:    { fontSize:12, color:C.text3, textAlign:'center', marginTop:8 },

  colorRow:        { flexDirection:'row', gap:12, marginBottom:4 },
  colorDot:        { width:36, height:36, borderRadius:18, borderWidth:2, borderColor:'transparent' },
  colorDotSelected:{ borderColor:'#fff', transform:[{scale:1.15}] },

  periodChip:     { paddingVertical:8, paddingHorizontal:16, borderRadius:20, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2 },
  periodChipText: { fontSize:13, color:C.text3, fontWeight:'500' },

  finalizarOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.6)', alignItems:'center', justifyContent:'center', paddingHorizontal:20 },
  finalizarCard:    { backgroundColor:C.surface, borderRadius:20, borderWidth:1, borderColor:C.border, paddingHorizontal:20, paddingVertical:24, width:'100%', maxWidth:360, shadowColor:'#000', shadowOffset:{width:0,height:12}, shadowOpacity:0.5, shadowRadius:20, elevation:16 },
  finalizarHeader:  { marginBottom:16, alignItems:'center' },
  finalizarTitle:   { fontSize:22, fontWeight:'700', color:C.accent2, letterSpacing:0.2 },
  finalizarContent: { marginBottom:20, gap:16 },
  finalizarSub:     { fontSize:14, color:C.text3, textAlign:'center' },
  finalizarTotals:  { flexDirection:'row', alignItems:'center', backgroundColor:C.surface2, borderRadius:14, borderWidth:1, borderColor:C.border, paddingVertical:12, paddingHorizontal:12 },
  finalizarTotal:   { flex:1, alignItems:'center' },
  finalizarDivider: { width:1, height:40, backgroundColor:C.border, marginHorizontal:8 },
  finalizarTotalLabel:{ fontSize:10, color:C.text3, fontWeight:'500', letterSpacing:0.4, textTransform:'uppercase', marginBottom:4 },
  finalizarTotalValue:{ fontSize:14, fontWeight:'700', color:C.accent },
  finalizarActions: { flexDirection:'row', gap:12 },
  finalizarBtnCancel:     { flex:1, paddingVertical:12, paddingHorizontal:12, borderRadius:12, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, alignItems:'center' },
  finalizarBtnCancelText: { fontSize:14, fontWeight:'600', color:C.text2 },
  finalizarBtnConfirm:    { flex:1, paddingVertical:12, paddingHorizontal:12, borderRadius:12, backgroundColor:C.accent, alignItems:'center', borderWidth:1, borderColor:C.accent },
  finalizarBtnConfirmText:{ fontSize:14, fontWeight:'700', color:'#fff' },

  modalOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.7)', justifyContent:'flex-end' },
  modalSheet:   { backgroundColor:C.surface, borderTopLeftRadius:24, borderTopRightRadius:24, padding:20, paddingBottom:40, borderTopWidth:1, borderTopColor:C.border },
  sheetHandle:  { width:40, height:4, backgroundColor:C.surface3, borderRadius:2, alignSelf:'center', marginBottom:20 },
  sheetTitle:   { fontSize:22, fontWeight:'700', color:C.accent2, marginBottom:4 },
  sheetSub:     { fontSize:13, color:C.text3, marginBottom:20 },

  pdfOption:        { flexDirection:'row', alignItems:'center', gap:14, paddingVertical:14, paddingHorizontal:14, backgroundColor:C.surface2, borderRadius:10, borderWidth:1, borderColor:C.border, marginBottom:10 },
  pdfOptionIconBox: { width:40, height:40, borderRadius:10, backgroundColor:C.surface3, alignItems:'center', justifyContent:'center' },
  pdfOptionIconText:{ fontSize:11, fontWeight:'700', color:C.accent2, letterSpacing:0.5 },
  pdfOptionTitle:   { fontSize:15, fontWeight:'600', color:C.text, marginBottom:2 },
  pdfOptionSub:     { fontSize:12, color:C.text3 },

  budgetOverlay:        { flex:1, backgroundColor:'rgba(0,0,0,0.7)', justifyContent:'flex-start', paddingHorizontal:24 },
  budgetCard:           { backgroundColor:C.surface, borderRadius:20, borderWidth:1, borderColor:C.border, padding:22, shadowColor:'#000', shadowOffset:{width:0,height:12}, shadowOpacity:0.5, shadowRadius:20, elevation:16 },
  budgetCardTitle:      { fontSize:20, fontWeight:'700', color:C.accent2, marginBottom:4 },
  budgetCardSub:        { fontSize:13, color:C.text3, marginBottom:18 },
  budgetBtnRow:         { flexDirection:'row', gap:10 },
  budgetBtnSave:        { flex:1, backgroundColor:C.accent, borderRadius:12, paddingVertical:14, alignItems:'center', justifyContent:'center' },
  budgetBtnSaveText:    { color:C.bg, fontSize:15, fontWeight:'700', letterSpacing:0.3 },
  budgetBtnDeactivate:  { flex:1, borderRadius:12, borderWidth:1, borderColor:'rgba(224,112,112,0.45)', backgroundColor:'rgba(224,112,112,0.1)', paddingVertical:14, alignItems:'center', justifyContent:'center' },
  budgetBtnDeactivateText:{ fontSize:14, fontWeight:'600', color:C.expense, letterSpacing:0.2 },
  budgetBtnCancel:      { flex:1, borderRadius:12, borderWidth:1, borderColor:C.border, backgroundColor:C.surface2, paddingVertical:14, alignItems:'center', justifyContent:'center' },
  budgetBtnCancelText:  { fontSize:14, fontWeight:'600', color:C.text2 },

  btnToggleForm:     { alignItems:'center', paddingVertical:7 },
  btnToggleFormText: { fontSize:11, color:C.text3, fontWeight:'500', letterSpacing:0.6 },
});
