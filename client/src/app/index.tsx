import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DateFilter } from '../../../seeker/types';
import { useEvents } from '../utils/use-events';
import { EventCard } from '../components/event-card';
import { endedToday, eventGroupLabel, eventsWord, groupEventRows, vilniusTime, type EventListItem } from '../utils/event-groups';
import type { DisplayEvent } from '../utils/events-api';
import { selectedDates, vilniusDate } from '../shared/event-date-filters';
import { artistsEnabled } from '../constants/features';
import { allCities, useCity } from '../components/city-picker';
import { track } from '../utils/analytics';
import { PageTitle, siteDescription, siteTitle } from '../components/page-title';

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

type ListItem = EventListItem<DisplayEvent> | { type: 'headline'; key: string } | { type: 'filters'; key: string };

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
  // Statistics: a search counts once the text has stayed the same for a while, so typing "jazz" is one search, not four.
  useEffect(() => {
    if (debouncedSearch.length < 2) return;
    const timer = setTimeout(() => track('searched', { query: debouncedSearch.toLocaleLowerCase('lt') }), 1500);
    return () => clearTimeout(timer);
  }, [debouncedSearch]);
  const filtersTracked = useRef(false);
  useEffect(() => {
    if (!filtersTracked.current) { filtersTracked.current = true; return; }
    track('filter_changed', { filter, free_only: freeOnly });
  }, [filter, freeOnly]);
  const focused = useRef(false);
  const list = useRef<FlatList<ListItem>>(null);
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
  const columns = width >= 1400 ? 4 : width >= 1100 ? 3 : width >= 700 ? 2 : 1;
  const desktop = columns > 1;
  const horizontalPadding = desktop ? 32 : 18;
  const contentWidth = Math.max(0, Math.min(width, 1264) - horizontalPadding * 2);
  const cardWidth = desktop ? (contentWidth - (columns - 1) * 20) / columns : undefined;
  const error = filter === 'custom' && (!validDate(from) || (to !== '' && !validDate(to))) ? 'Įveskite galiojančią datą formatu MMMM-MM-DD.' : filter === 'custom' && to && to < from ? 'Pabaigos data turi būti ne ankstesnė nei pradžios data.' : '';
  // On a first visit the city is decided a moment after start (see CityProvider); wait rather than load all of Lithuania first.
  const waitingForCity = city === null;
  const remote = useEvents(filter, from, to, Boolean(error) || waitingForCity, debouncedSearch, freeOnly, !city || city === allCities ? '' : city);
  const searching = search.trim() !== debouncedSearch;
  const emptyHint = city && city !== allCities ? 'Pabandykite pasirinkti kitą miestą arba pakeisti filtrus.'
    : debouncedSearch || freeOnly ? 'Pabandykite pakeisti paiešką arba filtrus.' : 'Išbandykite kitą datų filtrą.';
  const today = vilniusDate();
  // Today's finished events drop off so "Šiandien" shows what is still ahead; re-checked every minute.
  const [now, setNow] = useState(() => vilniusTime());
  useEffect(() => { const timer = setInterval(() => setNow(vilniusTime()), 60_000); return () => clearInterval(timer); }, []);
  const displayed = remote.items.filter(event => !endedToday(event, today, now));
  const total = Math.max(0, remote.total - (remote.items.length - displayed.length));
  const allEnded = filter === 'today' && remote.items.length > 0 && !displayed.length;
  const range = selectedDates(filter, from, to);
  const rangeStart = range && 'from' in range && range.from ? range.from : today;
  const tomorrow = selectedDates('tomorrow', '', '')!.from!;
  const limit = desktop ? 12 : 6;
  const limits: Record<string, number> = {};
  if (filter === 'upcoming') for (const day of [today, tomorrow]) if (!expandedDates.includes(day)) limits[day] = limit;
  const rows = groupEventRows(displayed, columns, rangeStart, limits);
  // On phones most events are compact rows; only the first couple of today's events get a large poster.
  const largeIds = new Set(desktop ? [] : rows.flatMap(row => row.type === 'row' && row.date === today ? row.events : []).slice(0, 2).map(event => event.id));
  // Search and date chips stay pinned while the list scrolls; on desktop they share one row.
  const filterBar = <View style={[styles.filterBar, desktop && styles.filterBarDesktop]}>
    <View style={desktop ? styles.filterRowDesktop : styles.filterRow}>
    <View style={[styles.searchRow, desktop && styles.searchRowDesktop]}>
      <View style={styles.searchBox}><View style={styles.searchIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.searchLens} /><View style={styles.searchHandle} /></View><TextInput value={search} onChangeText={value => { setExpandedDates([]); setSearch(value); }} placeholder={artistsEnabled ? 'Ieškoti renginio, vietos, atlikėjo...' : 'Ieškoti renginio ar vietos...'} placeholderTextColor="#aaa0ad" accessibilityLabel={artistsEnabled ? 'Ieškoti renginio, vietos arba atlikėjo' : 'Ieškoti renginio arba vietos'} returnKeyType="search" style={styles.searchInput} />{search ? <Pressable onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Išvalyti paiešką" hitSlop={8}><Text style={styles.clearSearch}>×</Text></Pressable> : null}</View>
      <Pressable onPress={() => setFiltersOpen(open => !open)} accessibilityRole="button" accessibilityLabel="Filtrai" accessibilityState={{ expanded: filtersOpen }} style={[styles.filterButton, freeOnly && styles.filterButtonActive]}><View style={styles.sliders} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.sliderLine}><View style={[styles.sliderKnob, { left: 4 }]} /></View><View style={styles.sliderLine}><View style={[styles.sliderKnob, { right: 4 }]} /></View><View style={styles.sliderLine}><View style={[styles.sliderKnob, { left: 7 }]} /></View></View>{freeOnly ? <View style={styles.filterBadge} /> : null}</Pressable>
    </View>
    <ScrollView horizontal style={desktop ? styles.chipsDesktop : undefined} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map(option => <Pressable key={option.id} onPress={() => { setExpandedDates([]); setFilter(option.id); }} accessibilityRole="button" accessibilityState={{ selected: filter === option.id }} style={[styles.filter, filter === option.id && styles.selected]}><Text style={[styles.filterText, filter === option.id && styles.selectedText]}>{option.label}</Text></Pressable>)}</ScrollView>
    </View>
    {filtersOpen ? <View style={[styles.filterPanel, desktop && { maxWidth: 600 }]}><Text style={styles.filterPanelTitle}>Filtrai</Text><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: freeOnly }} onPress={() => { setExpandedDates([]); setFreeOnly(value => !value); }} style={styles.filterOption}><View style={[styles.checkbox, freeOnly && styles.checkboxChecked]}>{freeOnly ? <Text style={styles.checkmark}>✓</Text> : null}</View><View style={{ flex: 1 }}><Text style={styles.optionTitle}>Nemokami renginiai</Text><Text style={styles.optionDescription}>Rodyti tik nemokamus renginius</Text></View></Pressable></View> : null}
    {filter === 'custom' ? <View style={[styles.dateInputs, desktop && { maxWidth: 520 }]}><View style={styles.inputGroup}><Text style={styles.label}>Nuo</Text><TextInput value={from} onChangeText={setFrom} placeholder="MMMM-MM-DD" placeholderTextColor="#8c8494" accessibilityLabel="Data nuo, metai mėnuo diena" style={styles.input} /></View><View style={styles.inputGroup}><Text style={styles.label}>Iki (nebūtina)</Text><TextInput value={to} onChangeText={setTo} placeholder="MMMM-MM-DD" placeholderTextColor="#8c8494" accessibilityLabel="Data iki, metai mėnuo diena" style={styles.input} /></View></View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : <Text style={styles.count}>{!waitingForCity && !searching && !remote.transitioning && !remote.error && (!remote.loading || remote.items.length) ? eventsWord(total) : '\u00a0'}</Text>}
  </View>;
  const emptyView = !waitingForCity && !error && !searching && !remote.loading && !remote.error && !rows.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>{allEnded ? 'Šiandienos renginiai jau baigėsi' : 'Renginių neradome'}</Text><Text style={styles.venue}>{allEnded ? 'Pažiūrėkite, kas vyks rytoj.' : emptyHint}</Text></View> : null;
  // The headline (desktop only) and the filter bar are list items, so the bar's sticky index is unambiguous.
  const data: ListItem[] = [{ type: 'headline', key: 'headline' }, { type: 'filters', key: 'filters' }, ...rows];
  return <><PageTitle title={siteTitle} description={siteDescription} /><FlatList ref={list} key={columns} data={data} stickyHeaderIndices={[1]} onLayout={(event: LayoutChangeEvent) => { viewportHeight.current=event.nativeEvent.layout.height; restoreScroll(); }} onContentSizeChange={(_width,height) => { contentHeight.current=height; restoreScroll(); }} onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => { if (!focused.current || restoreOffset.current) return; scrollOffset.current=event.nativeEvent.contentOffset.y; if(homeState) homeState.offset=scrollOffset.current; }} scrollEventThrottle={100} keyExtractor={item => item.key} renderItem={({ item }) => {
    // The page's one main heading: shown on wide screens, kept for search engines and screen readers on phones.
    if (item.type === 'headline') return <View style={desktop ? styles.headerDesktop : styles.visuallyHidden}><Text role="heading" aria-level={1} style={styles.headingDesktop}>Atrask savo kitą vakarą.</Text></View>;
    if (item.type === 'filters') return filterBar;
    if (item.type === 'heading') {
      const label = eventGroupLabel(item.date, today);
      return <View style={styles.dayHeading}><Text role="heading" aria-level={2} style={styles.dayTitle}>{label.title}</Text>{label.date ? <Text style={styles.dayDate}>{label.date}</Text> : null}</View>;
    }
    if (item.type === 'more') return <Pressable accessibilityRole="button" accessibilityLabel={`Rodyti dar ${eventsWord(item.remaining)}: ${eventGroupLabel(item.date, today).title}`} onPress={() => setExpandedDates(previous => [...previous, item.date])} style={styles.showMore}><Text style={styles.showMoreText}>Rodyti daugiau ({item.remaining})</Text></Pressable>;
    return <View style={styles.cardRow}>{item.events.map(event => <EventCard key={event.id} event={event} width={cardWidth ?? contentWidth} hideDate={item.date != null} variant={desktop || largeIds.has(event.id) ? 'large' : 'compact'} />)}</View>;
  }} onEndReached={() => { if (!remote.error && !searching) remote.loadMore(); }} onEndReachedThreshold={0.5} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ width: '100%', maxWidth: 1264, alignSelf: 'center', paddingHorizontal: horizontalPadding, paddingBottom: Math.max(insets.bottom, 32), gap: desktop ? 20 : 10, minHeight: remote.transitioning ? viewportHeight.current + scrollOffset.current : undefined }} ListFooterComponent={!error ? emptyView ?? <View style={styles.empty}>{searching || remote.loading ? <Text style={styles.venue}>{search.trim() ? 'Ieškoma renginių...' : 'Kraunami renginiai...'}</Text> : null}{remote.error ? <><Text accessibilityRole="alert" style={styles.error}>Nepavyko įkelti renginių.</Text><Pressable accessibilityRole="button" onPress={remote.transitioning || !remote.items.length ? remote.retry : remote.loadMore}><Text style={styles.link}>Bandyti dar kartą</Text></Pressable></> : null}{remote.next != null && !remote.loading && !remote.error ? <Pressable accessibilityRole="button" onPress={remote.loadMore}><Text style={styles.link}>Rodyti daugiau</Text></Pressable> : null}</View> : null} /></>;
}
const styles = StyleSheet.create({
  filterButtonActive: { borderWidth: 1, borderColor: '#ed7d83' }, filterBadge: { position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 4, backgroundColor: '#ed7d83' }, filterPanel: { padding: 16, borderWidth: 1, borderColor: '#413742', borderRadius: 14, backgroundColor: '#201b24', gap: 14 }, filterPanelTitle: { color: '#fff', fontWeight: '700', fontSize: 16 }, filterOption: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }, checkbox: { width: 22, height: 22, borderWidth: 1.5, borderColor: '#aa9aa9', borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, checkboxChecked: { backgroundColor: '#ed7d83', borderColor: '#ed7d83' }, checkmark: { color: '#201b24', fontWeight: '800', fontSize: 15 }, optionTitle: { color: '#fff', fontSize: 15, fontWeight: '700' }, optionDescription: { color: '#b9b0bd', fontSize: 13, marginTop: 3 },
  showMore: { alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 11, borderRadius: 24, borderWidth: 1, borderColor: '#66515d', backgroundColor: '#201b24' }, showMoreText: { color: '#f1c6c7', fontSize: 14, fontWeight: '700' },
  dayHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 4, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#413742' }, dayTitle: { color: '#fff', fontSize: 25, fontWeight: '800', letterSpacing: -0.5 }, dayDate: { color: '#b9b0bd', fontSize: 14 }, cardRow: { flexDirection: 'row', gap: 20 },
  searchRow: { flexDirection: 'row', gap: 8 }, searchBox: { flex: 1, minWidth: 0, height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, backgroundColor: '#201b24', borderWidth: 1, borderColor: '#413742', borderRadius: 12 }, searchIcon: { width: 18, height: 18 }, searchLens: { width: 12, height: 12, borderWidth: 1.7, borderColor: '#b9b0bd', borderRadius: 7 }, searchHandle: { position: 'absolute', width: 7, height: 1.7, backgroundColor: '#b9b0bd', transform: [{ rotate: '45deg' }], left: 10, top: 12 }, searchInput: { flex: 1, minWidth: 0, color: '#fff', fontSize: 16, paddingVertical: 0 }, clearSearch: { color: '#c5bac7', fontSize: 24, lineHeight: 28 }, filterButton: { height: 48, width: 48, borderRadius: 12, backgroundColor: '#302a33', alignItems: 'center', justifyContent: 'center' }, sliders: { width: 18, gap: 4 }, sliderLine: { height: 1.5, backgroundColor: '#d5cbd6', justifyContent: 'center' }, sliderKnob: { position: 'absolute', height: 5, width: 5, borderRadius: 3, backgroundColor: '#d5cbd6' },
  headerDesktop: { paddingTop: 28 }, visuallyHidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }, headingDesktop: { color: '#fff', fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8 },
  filterBar: { backgroundColor: '#100e15', paddingTop: 10, paddingBottom: 4, gap: 8 }, filterBarDesktop: { paddingTop: 14, gap: 10 },
  filterRow: { gap: 2 }, filterRowDesktop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  searchRowDesktop: { width: 440 }, chipsDesktop: { flex: 1 },
  filters: { gap: 8, paddingVertical: 8 }, filter: { borderColor: '#413742', borderWidth: 1, borderRadius: 30, paddingHorizontal: 16, paddingVertical: 10 }, selected: { backgroundColor: '#f0e8e7', borderColor: '#f0e8e7' }, filterText: { color: '#e4dbe3', fontSize: 14, fontWeight: '600' }, selectedText: { color: '#1b121b' }, count: { color: '#b9b0bd', fontSize: 13 }, card: { backgroundColor: '#201b24', borderRadius: 18, overflow: 'hidden' }, image: { width: '100%', height: 220, backgroundColor: '#302631' }, placeholder: { alignItems: 'center', justifyContent: 'center' }, placeholderText: { color: '#80616a', fontWeight: '900', letterSpacing: 4, fontSize: 20 }, cardBody: { padding: 18, gap: 8 }, date: { color: '#ee969b', fontSize: 13, fontWeight: '700' }, title: { color: '#fff', fontSize: 21, lineHeight: 27, fontWeight: '700' }, venue: { color: '#c5bac7', fontSize: 15, lineHeight: 21 }, artists: { color: '#a99dab', fontSize: 13, lineHeight: 19 }, link: { color: '#f1c6c7', fontSize: 13, fontWeight: '700', paddingTop: 6 }, empty: { paddingVertical: 48, alignItems: 'center', gap: 8 }, emptyTitle: { color: '#fff', fontSize: 19, fontWeight: '700' }, dateInputs: { flexDirection: 'row', gap: 10 }, inputGroup: { flex: 1, gap: 6 }, label: { color: '#ded4df', fontSize: 13 }, input: { color: '#fff', borderWidth: 1, borderColor: '#554a57', borderRadius: 10, padding: 12 }, error: { color: '#ffaaaa', fontSize: 13, lineHeight: 19 },
});
