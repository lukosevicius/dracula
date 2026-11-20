import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DateFilter } from '../../../seeker/types';
import { useEvents } from '../utils/use-events';
import { EventCard } from '../components/event-card';
import { eventGroupLabel, groupEventRows } from '../utils/event-groups';
import { selectedDates, vilniusDate } from '../shared/event-date-filters';

const filters: { id: DateFilter; label: string }[] = [
  { id: 'upcoming', label: 'Artėjantys' }, { id: 'today', label: 'Šiandien' },
  { id: 'tomorrow', label: 'Rytoj' }, { id: 'weekend', label: 'Šį savaitgalį' },
  { id: 'custom', label: 'Pasirinkti datas' }, { id: 'all', label: 'Visi' },
  { id: 'unknown', label: 'Data nežinoma' },
];

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export default function Home() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const [expandedDates, setExpandedDates] = useState<string[]>([]);
  const [filter, setFilter] = useState<DateFilter>('upcoming');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const columns = width >= 1100 ? 3 : width >= 700 ? 2 : 1;
  const desktop = columns > 1;
  const horizontalPadding = desktop ? 32 : 18;
  const contentWidth = Math.max(0, Math.min(width, 1264) - horizontalPadding * 2);
  const cardWidth = desktop ? (contentWidth - (columns - 1) * 20) / columns : undefined;
  const error = filter === 'custom' && (!validDate(from) || (to !== '' && !validDate(to))) ? 'Įveskite galiojančią datą formatu MMMM-MM-DD.' : filter === 'custom' && to && to < from ? 'Pabaigos data turi būti ne ankstesnė nei pradžios data.' : '';
  const remote = useEvents(filter, from, to, Boolean(error), debouncedSearch);
  const searching = search.trim() !== debouncedSearch;
  const displayed = searching ? [] : remote.items;
  const today = vilniusDate();
  const range = selectedDates(filter, from, to);
  const rangeStart = range && 'from' in range && range.from ? range.from : today;
  const tomorrow = selectedDates('tomorrow', '', '')!.from!;
  const limit = desktop ? 12 : 6;
  const limits: Record<string, number> = {};
  if (filter === 'upcoming') for (const day of [today, tomorrow]) if (!expandedDates.includes(day)) limits[day] = limit;
  const rows = groupEventRows(displayed, columns, rangeStart, limits);
  return <FlatList key={columns} data={rows} keyExtractor={item => item.key} renderItem={({ item }) => {
    if (item.type === 'heading') {
      const label = eventGroupLabel(item.date, today);
      return <View style={styles.dayHeading} accessibilityRole="header"><Text style={styles.dayTitle}>{label.title}</Text>{label.date ? <Text style={styles.dayDate}>{label.date}</Text> : null}</View>;
    }
    if (item.type === 'more') return <Pressable accessibilityRole="button" accessibilityLabel={`Rodyti dar ${item.remaining} renginių: ${eventGroupLabel(item.date, today).title}`} onPress={() => setExpandedDates(previous => [...previous, item.date])} style={styles.showMore}><Text style={styles.showMoreText}>Rodyti daugiau ({item.remaining})</Text></Pressable>;
    return <View style={styles.cardRow}>{item.events.map(event => <EventCard key={event.id} event={event} width={cardWidth ?? contentWidth} />)}</View>;
  }} onEndReached={() => { if (!remote.error && !searching) remote.loadMore(); }} onEndReachedThreshold={0.5} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ width: '100%', maxWidth: 1264, alignSelf: 'center', paddingHorizontal: horizontalPadding, paddingBottom: Math.max(insets.bottom, 32), gap: desktop ? 20 : 18 }} ListHeaderComponent={<View style={[styles.header, desktop && styles.headerDesktop]}>
    <Text style={styles.eyebrow}>VILNIAUS RENGINIAI</Text><Text style={[styles.heading, desktop && styles.headingDesktop]}>{'Atrask savo\nkitą vakarą.'}</Text>
    <Text style={styles.intro}>Muzika, žmonės ir vietos, kurias verta atrasti.</Text>
    <View style={[styles.searchRow, desktop && { maxWidth: 600 }]}>
      <View style={styles.searchBox}><View style={styles.searchIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.searchLens} /><View style={styles.searchHandle} /></View><TextInput value={search} onChangeText={value => { setExpandedDates([]); setSearch(value); }} placeholder="Ieškoti renginio, vietos, atlikėjo..." placeholderTextColor="#aaa0ad" accessibilityLabel="Ieškoti renginio, vietos arba atlikėjo" returnKeyType="search" style={styles.searchInput} />{search ? <Pressable onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Išvalyti paiešką" hitSlop={8}><Text style={styles.clearSearch}>×</Text></Pressable> : null}</View>
      <Pressable disabled accessibilityRole="button" accessibilityLabel="Filtrai, netrukus" accessibilityState={{ disabled: true }} style={styles.filterButton}><View style={styles.sliders} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.sliderLine}><View style={[styles.sliderKnob, { left: 4 }]} /></View><View style={styles.sliderLine}><View style={[styles.sliderKnob, { right: 4 }]} /></View><View style={styles.sliderLine}><View style={[styles.sliderKnob, { left: 7 }]} /></View></View></Pressable>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map(option => <Pressable key={option.id} onPress={() => { setExpandedDates([]); setFilter(option.id); }} accessibilityRole="button" accessibilityState={{ selected: filter === option.id }} style={[styles.filter, filter === option.id && styles.selected]}><Text style={[styles.filterText, filter === option.id && styles.selectedText]}>{option.label}</Text></Pressable>)}</ScrollView>
    {filter === 'custom' ? <View style={[styles.dateInputs, desktop && { maxWidth: 520 }]}><View style={styles.inputGroup}><Text style={styles.label}>Nuo</Text><TextInput value={from} onChangeText={setFrom} placeholder="MMMM-MM-DD" placeholderTextColor="#8c8494" accessibilityLabel="Data nuo, metai mėnuo diena" style={styles.input} /></View><View style={styles.inputGroup}><Text style={styles.label}>Iki (nebūtina)</Text><TextInput value={to} onChangeText={setTo} placeholder="MMMM-MM-DD" placeholderTextColor="#8c8494" accessibilityLabel="Data iki, metai mėnuo diena" style={styles.input} /></View></View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : (!searching && !remote.loading && !remote.error) || (!searching && remote.items.length) ? <Text style={styles.count}>{remote.total} renginių</Text> : null}
  </View>} ListEmptyComponent={!error && (!searching && !remote.loading && !remote.error) ? <View style={styles.empty}><Text style={styles.emptyTitle}>Renginių neradome</Text><Text style={styles.venue}>{debouncedSearch ? 'Pabandykite kitą paiešką arba datos filtrą.' : 'Išbandykite kitą datų filtrą.'}</Text></View> : null} ListFooterComponent={!error ? <View style={styles.empty}>{searching || remote.loading ? <Text style={styles.venue}>{search.trim() ? 'Ieškoma renginių...' : 'Kraunami renginiai...'}</Text> : null}{remote.error ? <><Text accessibilityRole="alert" style={styles.error}>Nepavyko įkelti renginių.</Text><Pressable accessibilityRole="button" onPress={remote.items.length ? remote.loadMore : remote.retry}><Text style={styles.link}>Bandyti dar kartą</Text></Pressable></> : null}{remote.next != null && !remote.loading && !remote.error ? <Pressable accessibilityRole="button" onPress={remote.loadMore}><Text style={styles.link}>Rodyti daugiau</Text></Pressable> : null}</View> : null} />;
}
const styles = StyleSheet.create({
  showMore: { alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 11, borderRadius: 24, borderWidth: 1, borderColor: '#66515d', backgroundColor: '#201b24' }, showMoreText: { color: '#f1c6c7', fontSize: 14, fontWeight: '700' },
  dayHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 4, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#413742' }, dayTitle: { color: '#fff', fontSize: 25, fontWeight: '800', letterSpacing: -0.5 }, dayDate: { color: '#b9b0bd', fontSize: 14 }, cardRow: { flexDirection: 'row', gap: 20 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 8 }, searchBox: { flex: 1, minWidth: 0, height: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, backgroundColor: '#201b24', borderWidth: 1, borderColor: '#413742', borderRadius: 12 }, searchIcon: { width: 18, height: 18 }, searchLens: { width: 12, height: 12, borderWidth: 1.7, borderColor: '#b9b0bd', borderRadius: 7 }, searchHandle: { position: 'absolute', width: 7, height: 1.7, backgroundColor: '#b9b0bd', transform: [{ rotate: '45deg' }], left: 10, top: 12 }, searchInput: { flex: 1, minWidth: 0, color: '#fff', fontSize: 16, paddingVertical: 0 }, clearSearch: { color: '#c5bac7', fontSize: 24, lineHeight: 28 }, filterButton: { height: 48, width: 48, borderRadius: 12, backgroundColor: '#302a33', alignItems: 'center', justifyContent: 'center' }, sliders: { width: 18, gap: 4 }, sliderLine: { height: 1.5, backgroundColor: '#d5cbd6', justifyContent: 'center' }, sliderKnob: { position: 'absolute', height: 5, width: 5, borderRadius: 3, backgroundColor: '#d5cbd6' },
  headerDesktop: { paddingTop: 48, paddingBottom: 12, gap: 16 }, headingDesktop: { fontSize: 58, lineHeight: 63, letterSpacing: -2 },
  header: { paddingTop: 20, gap: 12 }, eyebrow: { color: '#ed7d83', fontSize: 11, fontWeight: '800', letterSpacing: 2 }, heading: { color: '#fff', fontSize: 38, lineHeight: 43, fontWeight: '800', letterSpacing: -1 }, intro: { color: '#b9b0bd', fontSize: 15, lineHeight: 22 }, filters: { gap: 8, paddingVertical: 8 }, filter: { borderColor: '#413742', borderWidth: 1, borderRadius: 30, paddingHorizontal: 16, paddingVertical: 10 }, selected: { backgroundColor: '#f0e8e7', borderColor: '#f0e8e7' }, filterText: { color: '#e4dbe3', fontSize: 14, fontWeight: '600' }, selectedText: { color: '#1b121b' }, count: { color: '#b9b0bd', fontSize: 13 }, card: { backgroundColor: '#201b24', borderRadius: 18, overflow: 'hidden' }, image: { width: '100%', height: 220, backgroundColor: '#302631' }, placeholder: { alignItems: 'center', justifyContent: 'center' }, placeholderText: { color: '#80616a', fontWeight: '900', letterSpacing: 4, fontSize: 20 }, cardBody: { padding: 18, gap: 8 }, date: { color: '#ee969b', fontSize: 13, fontWeight: '700' }, title: { color: '#fff', fontSize: 21, lineHeight: 27, fontWeight: '700' }, venue: { color: '#c5bac7', fontSize: 15, lineHeight: 21 }, artists: { color: '#a99dab', fontSize: 13, lineHeight: 19 }, link: { color: '#f1c6c7', fontSize: 13, fontWeight: '700', paddingTop: 6 }, empty: { paddingVertical: 48, alignItems: 'center', gap: 8 }, emptyTitle: { color: '#fff', fontSize: 19, fontWeight: '700' }, dateInputs: { flexDirection: 'row', gap: 10 }, inputGroup: { flex: 1, gap: 6 }, label: { color: '#ded4df', fontSize: 13 }, input: { color: '#fff', borderWidth: 1, borderColor: '#554a57', borderRadius: 10, padding: 12 }, error: { color: '#ffaaaa', fontSize: 13, lineHeight: 19 },
});
