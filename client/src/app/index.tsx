import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DateFilter } from '../../../seeker/types';
import { useEvents } from '../utils/use-events';
import { EventCard } from '../components/event-card';
import { eventGroupLabel, groupEventRows, type EventListItem } from '../utils/event-groups';
import type { DisplayEvent } from '../utils/events-api';
import { selectedDates, vilniusDate } from '../shared/event-date-filters';
import { artistsEnabled } from '../constants/features';
import { useCity } from '../components/city-picker';

const filters: { id: DateFilter; label: string }[] = [
  { id: 'upcoming', label: 'Visi' }, { id: 'today', label: 'Šiandien' },
  { id: 'tomorrow', label: 'Rytoj' }, { id: 'weekend', label: 'Šį savaitgalį' },
  { id: 'custom', label: 'Pasirinkti datas' },
];

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

let homeState: { filtersOpen: boolean; freeOnly: boolean; search: string; expandedDates: string[]; filter: DateFilter; from: string; to: string; offset: number } | null = null;

export default function Home() {
  const initial = useRef(homeState).current;
  const { city } = useCity();
  const [filtersOpen, setFiltersOpen] = useState(initial?.filtersOpen ?? false);
  const [freeOnly, setFreeOnly] = useState(initial?.freeOnly ?? false);
  const [search, setSearch] = useState(initial?.search ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(initial?.search.trim() ?? '');
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const [expandedDates, setExpandedDates] = useState<string[]>(initial?.expandedDates ?? []);
  const [filter, setFilter] = useState<DateFilter>(initial?.filter ?? 'upcoming');
  const [from, setFrom] = useState(initial?.from ?? '');
  const [to, setTo] = useState(initial?.to ?? '');
  const focused = useRef(false);
  const list = useRef<FlatList<EventListItem<DisplayEvent>>>(null);
  const scrollOffset = useRef(initial?.offset ?? 0);
  const restoreOffset = useRef(initial?.offset ?? 0);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  function restoreScroll() {
    if (!focused.current || !restoreOffset.current || !viewportHeight.current || contentHeight.current - viewportHeight.current < restoreOffset.current - 1) return;
    const offset = restoreOffset.current;
    requestAnimationFrame(() => { list.current?.scrollToOffset({offset,animated:false}); restoreOffset.current=0; });
  }
  useFocusEffect(useCallback(() => {
    focused.current=true;
    restoreScroll();
    return () => { focused.current=false; };
  }, []));
  useEffect(() => {
    if (focused.current) homeState = { filtersOpen, freeOnly, search, expandedDates, filter, from, to, offset: scrollOffset.current };
  }, [filtersOpen, freeOnly, search, expandedDates, filter, from, to]);
  const previousCity = useRef(city);
  useEffect(() => { if (previousCity.current !== city) { previousCity.current = city; setExpandedDates([]); } }, [city]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const columns = width >= 1100 ? 3 : width >= 700 ? 2 : 1;
  const desktop = columns > 1;
  const horizontalPadding = desktop ? 32 : 18;
  const contentWidth = Math.max(0, Math.min(width, 1264) - horizontalPadding * 2);
  const cardWidth = desktop ? (contentWidth - (columns - 1) * 20) / columns : undefined;
  const error = filter === 'custom' && (!validDate(from) || (to !== '' && !validDate(to))) ? 'Įveskite galiojančią datą formatu MMMM-MM-DD.' : filter === 'custom' && to && to < from ? 'Pabaigos data turi būti ne ankstesnė nei pradžios data.' : '';
  const remote = useEvents(filter, from, to, Boolean(error), debouncedSearch, freeOnly, city === 'Visi' ? '' : city);
  const searching = search.trim() !== debouncedSearch;
  const emptyHint = city !== 'Visi' ? 'Pabandykite pasirinkti kitą miestą arba pakeisti filtrus.'
    : debouncedSearch || freeOnly ? 'Pabandykite pakeisti paiešką arba filtrus.' : 'Išbandykite kitą datų filtrą.';
  const displayed = remote.items;
  const today = vilniusDate();
  const range = selectedDates(filter, from, to);
  const rangeStart = range && 'from' in range && range.from ? range.from : today;
  const tomorrow = selectedDates('tomorrow', '', '')!.from!;
  const limit = desktop ? 12 : 6;
  const limits: Record<string, number> = {};
  if (filter === 'upcoming') for (const day of [today, tomorrow]) if (!expandedDates.includes(day)) limits[day] = limit;
  const rows = groupEventRows(displayed, columns, rangeStart, limits);
  // On phones most events are compact rows; only the first couple of today's events get a large poster.
  const largeIds = new Set(desktop ? [] : rows.flatMap(row => row.type === 'row' && row.date === today ? row.events : []).slice(0, 2).map(event => event.id));
  return <FlatList ref={list} key={columns} data={rows} onLayout={(event: LayoutChangeEvent) => { viewportHeight.current=event.nativeEvent.layout.height; restoreScroll(); }} onContentSizeChange={(_width,height) => { contentHeight.current=height; restoreScroll(); }} onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => { if (!focused.current || restoreOffset.current) return; scrollOffset.current=event.nativeEvent.contentOffset.y; if(homeState) homeState.offset=scrollOffset.current; }} scrollEventThrottle={100} keyExtractor={item => item.key} renderItem={({ item }) => {
    if (item.type === 'heading') {
      const label = eventGroupLabel(item.date, today);
      return <View style={styles.dayHeading} accessibilityRole="header"><Text style={styles.dayTitle}>{label.title}</Text>{label.date ? <Text style={styles.dayDate}>{label.date}</Text> : null}</View>;
    }
    if (item.type === 'more') return <Pressable accessibilityRole="button" accessibilityLabel={`Rodyti dar ${item.remaining} renginių: ${eventGroupLabel(item.date, today).title}`} onPress={() => setExpandedDates(previous => [...previous, item.date])} style={styles.showMore}><Text style={styles.showMoreText}>Rodyti daugiau ({item.remaining})</Text></Pressable>;
    return <View style={styles.cardRow}>{item.events.map(event => <EventCard key={event.id} event={event} width={cardWidth ?? contentWidth} hideDate={item.date != null} variant={desktop || largeIds.has(event.id) ? 'large' : 'compact'} />)}</View>;
  }} onEndReached={() => { if (!remote.error && !searching) remote.loadMore(); }} onEndReachedThreshold={0.5} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ width: '100%', maxWidth: 1264, alignSelf: 'center', paddingHorizontal: horizontalPadding, paddingBottom: Math.max(insets.bottom, 32), gap: desktop ? 20 : 10, minHeight: remote.transitioning ? viewportHeight.current + scrollOffset.current : undefined }} ListHeaderComponent={<View style={[styles.header, desktop && styles.headerDesktop]}>
    {desktop ? <><Text style={[styles.heading, styles.headingDesktop]}>{'Atrask savo\nkitą vakarą.'}</Text><Text style={styles.intro}>Muzika, žmonės ir vietos, kurias verta atrasti.</Text></> : null}
    <View style={[styles.searchRow, desktop && { maxWidth: 600 }]}>
      <View style={styles.searchBox}><View style={styles.searchIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.searchLens} /><View style={styles.searchHandle} /></View><TextInput value={search} onChangeText={value => { setExpandedDates([]); setSearch(value); }} placeholder={artistsEnabled ? 'Ieškoti renginio, vietos, atlikėjo...' : 'Ieškoti renginio ar vietos...'} placeholderTextColor="#aaa0ad" accessibilityLabel={artistsEnabled ? 'Ieškoti renginio, vietos arba atlikėjo' : 'Ieškoti renginio arba vietos'} returnKeyType="search" style={styles.searchInput} />{search ? <Pressable onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Išvalyti paiešką" hitSlop={8}><Text style={styles.clearSearch}>×</Text></Pressable> : null}</View>
      <Pressable onPress={() => setFiltersOpen(open => !open)} accessibilityRole="button" accessibilityLabel="Filtrai" accessibilityState={{ expanded: filtersOpen }} style={[styles.filterButton, freeOnly && styles.filterButtonActive]}><View style={styles.sliders} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.sliderLine}><View style={[styles.sliderKnob, { left: 4 }]} /></View><View style={styles.sliderLine}><View style={[styles.sliderKnob, { right: 4 }]} /></View><View style={styles.sliderLine}><View style={[styles.sliderKnob, { left: 7 }]} /></View></View>{freeOnly ? <View style={styles.filterBadge} /> : null}</Pressable>
    </View>
    {filtersOpen ? <View style={[styles.filterPanel, desktop && { maxWidth: 600 }]}><Text style={styles.filterPanelTitle}>Filtrai</Text><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: freeOnly }} onPress={() => { setExpandedDates([]); setFreeOnly(value => !value); }} style={styles.filterOption}><View style={[styles.checkbox, freeOnly && styles.checkboxChecked]}>{freeOnly ? <Text style={styles.checkmark}>✓</Text> : null}</View><View style={{ flex: 1 }}><Text style={styles.optionTitle}>Nemokami renginiai</Text><Text style={styles.optionDescription}>Rodyti tik nemokamus renginius</Text></View></Pressable></View> : null}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map(option => <Pressable key={option.id} onPress={() => { setExpandedDates([]); setFilter(option.id); }} accessibilityRole="button" accessibilityState={{ selected: filter === option.id }} style={[styles.filter, filter === option.id && styles.selected]}><Text style={[styles.filterText, filter === option.id && styles.selectedText]}>{option.label}</Text></Pressable>)}</ScrollView>
    {filter === 'custom' ? <View style={[styles.dateInputs, desktop && { maxWidth: 520 }]}><View style={styles.inputGroup}><Text style={styles.label}>Nuo</Text><TextInput value={from} onChangeText={setFrom} placeholder="MMMM-MM-DD" placeholderTextColor="#8c8494" accessibilityLabel="Data nuo, metai mėnuo diena" style={styles.input} /></View><View style={styles.inputGroup}><Text style={styles.label}>Iki (nebūtina)</Text><TextInput value={to} onChangeText={setTo} placeholder="MMMM-MM-DD" placeholderTextColor="#8c8494" accessibilityLabel="Data iki, metai mėnuo diena" style={styles.input} /></View></View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : <Text style={styles.count}>{!searching && !remote.transitioning && !remote.error && (!remote.loading || remote.items.length) ? `${remote.total} renginių` : '\u00a0'}</Text>}
  </View>} ListEmptyComponent={!error && (!searching && !remote.loading && !remote.error) ? <View style={styles.empty}><Text style={styles.emptyTitle}>Renginių neradome</Text><Text style={styles.venue}>{emptyHint}</Text></View> : null} ListFooterComponent={!error ? <View style={styles.empty}>{searching || remote.loading ? <Text style={styles.venue}>{search.trim() ? 'Ieškoma renginių...' : 'Kraunami renginiai...'}</Text> : null}{remote.error ? <><Text accessibilityRole="alert" style={styles.error}>Nepavyko įkelti renginių.</Text><Pressable accessibilityRole="button" onPress={remote.transitioning || !remote.items.length ? remote.retry : remote.loadMore}><Text style={styles.link}>Bandyti dar kartą</Text></Pressable></> : null}{remote.next != null && !remote.loading && !remote.error ? <Pressable accessibilityRole="button" onPress={remote.loadMore}><Text style={styles.link}>Rodyti daugiau</Text></Pressable> : null}</View> : null} />;
}
const styles = StyleSheet.create({
  filterButtonActive: { borderWidth: 1, borderColor: '#ed7d83' }, filterBadge: { position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 4, backgroundColor: '#ed7d83' }, filterPanel: { padding: 16, borderWidth: 1, borderColor: '#413742', borderRadius: 14, backgroundColor: '#201b24', gap: 14 }, filterPanelTitle: { color: '#fff', fontWeight: '700', fontSize: 16 }, filterOption: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }, checkbox: { width: 22, height: 22, borderWidth: 1.5, borderColor: '#aa9aa9', borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, checkboxChecked: { backgroundColor: '#ed7d83', borderColor: '#ed7d83' }, checkmark: { color: '#201b24', fontWeight: '800', fontSize: 15 }, optionTitle: { color: '#fff', fontSize: 15, fontWeight: '700' }, optionDescription: { color: '#b9b0bd', fontSize: 13, marginTop: 3 },
  showMore: { alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 11, borderRadius: 24, borderWidth: 1, borderColor: '#66515d', backgroundColor: '#201b24' }, showMoreText: { color: '#f1c6c7', fontSize: 14, fontWeight: '700' },
  dayHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 4, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#413742' }, dayTitle: { color: '#fff', fontSize: 25, fontWeight: '800', letterSpacing: -0.5 }, dayDate: { color: '#b9b0bd', fontSize: 14 }, cardRow: { flexDirection: 'row', gap: 20 },
  searchRow: { flexDirection: 'row', gap: 8 }, searchBox: { flex: 1, minWidth: 0, height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, backgroundColor: '#201b24', borderWidth: 1, borderColor: '#413742', borderRadius: 12 }, searchIcon: { width: 18, height: 18 }, searchLens: { width: 12, height: 12, borderWidth: 1.7, borderColor: '#b9b0bd', borderRadius: 7 }, searchHandle: { position: 'absolute', width: 7, height: 1.7, backgroundColor: '#b9b0bd', transform: [{ rotate: '45deg' }], left: 10, top: 12 }, searchInput: { flex: 1, minWidth: 0, color: '#fff', fontSize: 16, paddingVertical: 0 }, clearSearch: { color: '#c5bac7', fontSize: 24, lineHeight: 28 }, filterButton: { height: 48, width: 48, borderRadius: 12, backgroundColor: '#302a33', alignItems: 'center', justifyContent: 'center' }, sliders: { width: 18, gap: 4 }, sliderLine: { height: 1.5, backgroundColor: '#d5cbd6', justifyContent: 'center' }, sliderKnob: { position: 'absolute', height: 5, width: 5, borderRadius: 3, backgroundColor: '#d5cbd6' },
  headerDesktop: { paddingTop: 48, paddingBottom: 12, gap: 16 }, headingDesktop: { fontSize: 58, lineHeight: 63, letterSpacing: -2 },
  header: { paddingTop: 8, gap: 10 }, heading: { color: '#fff', fontWeight: '800' }, intro: { color: '#b9b0bd', fontSize: 15, lineHeight: 22 }, filters: { gap: 8, paddingVertical: 8 }, filter: { borderColor: '#413742', borderWidth: 1, borderRadius: 30, paddingHorizontal: 16, paddingVertical: 10 }, selected: { backgroundColor: '#f0e8e7', borderColor: '#f0e8e7' }, filterText: { color: '#e4dbe3', fontSize: 14, fontWeight: '600' }, selectedText: { color: '#1b121b' }, count: { color: '#b9b0bd', fontSize: 13 }, card: { backgroundColor: '#201b24', borderRadius: 18, overflow: 'hidden' }, image: { width: '100%', height: 220, backgroundColor: '#302631' }, placeholder: { alignItems: 'center', justifyContent: 'center' }, placeholderText: { color: '#80616a', fontWeight: '900', letterSpacing: 4, fontSize: 20 }, cardBody: { padding: 18, gap: 8 }, date: { color: '#ee969b', fontSize: 13, fontWeight: '700' }, title: { color: '#fff', fontSize: 21, lineHeight: 27, fontWeight: '700' }, venue: { color: '#c5bac7', fontSize: 15, lineHeight: 21 }, artists: { color: '#a99dab', fontSize: 13, lineHeight: 19 }, link: { color: '#f1c6c7', fontSize: 13, fontWeight: '700', paddingTop: 6 }, empty: { paddingVertical: 48, alignItems: 'center', gap: 8 }, emptyTitle: { color: '#fff', fontSize: 19, fontWeight: '700' }, dateInputs: { flexDirection: 'row', gap: 10 }, inputGroup: { flex: 1, gap: 6 }, label: { color: '#ded4df', fontSize: 13 }, input: { color: '#fff', borderWidth: 1, borderColor: '#554a57', borderRadius: 10, padding: 12 }, error: { color: '#ffaaaa', fontSize: 13, lineHeight: 19 },
});
