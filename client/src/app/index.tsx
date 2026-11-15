import { useMemo, useState } from 'react';
import { Alert, FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { matchesDate, selectedDates, vilniusDate } from '../shared/event-date-filters';
import type { DateFilter, PublicEvent } from '../../../seeker/types';
import snapshot from '../data/events.json';
import { eventImages } from '../data/event-images';

const events: PublicEvent[] = snapshot;
const filters: { id: DateFilter; label: string }[] = [
  { id: 'upcoming', label: 'Artėjantys' }, { id: 'today', label: 'Šiandien' },
  { id: 'tomorrow', label: 'Rytoj' }, { id: 'weekend', label: 'Šį savaitgalį' },
  { id: 'custom', label: 'Pasirinkti datas' }, { id: 'all', label: 'Visi' },
  { id: 'past', label: 'Praėję' }, { id: 'unknown', label: 'Data nežinoma' },
];

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function displayDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Data nežinoma';
}
function displayText(value: string) {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (entity, code: string) => {
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}
function EventCard({ event }: { event: PublicEvent }) {
  const [failed, setFailed] = useState(false);
  const title = displayText(event.title);
  const source = event.image == null ? undefined : eventImages[event.image];
  async function open() {
    try { await Linking.openURL(event.source_url); }
    catch { Alert.alert('Nepavyko atidaryti nuorodos', 'Bandykite dar kartą.'); }
  }
  return <Pressable accessibilityRole="link" accessibilityLabel={`${title}, atidaryti renginio puslapį`} onPress={open} style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
    {source && !failed ? <Image source={source} style={styles.image} contentFit="cover" onError={() => setFailed(true)} accessibilityLabel={`Renginio ${title} nuotrauka`} /> : <View style={[styles.image, styles.placeholder]}><Text style={styles.placeholderText}>DRACULA</Text></View>}
    <View style={styles.cardBody}>
      <Text style={styles.date}>{displayDate(event.event_date)}{event.event_end_date && event.event_end_date !== event.event_date ? ` – ${displayDate(event.event_end_date)}` : ''}{event.event_time ? ` · ${event.event_time}` : ''}</Text>
      <Text style={styles.title}>{title}</Text>
      {event.venue ? <Text style={styles.venue}>{displayText(event.venue)}</Text> : null}
      {event.artists.length ? <Text style={styles.artists}>{event.artists.map(a => displayText(a.name)).join(' · ')}</Text> : null}
      <Text style={styles.link}>Daugiau apie renginį ↗</Text>
    </View>
  </Pressable>;
}

export default function Home() {
  const [filter, setFilter] = useState<DateFilter>('upcoming');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const insets = useSafeAreaInsets();
  const error = filter === 'custom' && (!validDate(from) || (to !== '' && !validDate(to))) ? 'Įveskite galiojančią datą formatu MMMM-MM-DD.' : filter === 'custom' && to && to < from ? 'Pabaigos data turi būti ne ankstesnė nei pradžios data.' : '';
  const visible = useMemo(() => {
    if (error) return [];
    const now = new Date();
    const today = vilniusDate(now);
    const range = selectedDates(filter, from, to, now);
    return events.filter(event => matchesDate(event, filter, range, today)).sort((a, b) => (a.event_date || '9999').localeCompare(b.event_date || '9999') || (a.event_time || '').localeCompare(b.event_time || '') || a.title.localeCompare(b.title, 'lt'));
  }, [filter, from, to, error]);
  return <FlatList data={visible} keyExtractor={item => String(item.id)} renderItem={({ item }) => <EventCard event={item} />} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: Math.max(insets.bottom, 24), gap: 18 }} ListHeaderComponent={<View style={styles.header}>
    <Text style={styles.eyebrow}>VILNIAUS RENGINIAI</Text><Text style={styles.heading}>{'Atrask savo\nkitą vakarą.'}</Text>
    <Text style={styles.intro}>Muzika, žmonės ir vietos, kurias verta atrasti.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map(option => <Pressable key={option.id} onPress={() => setFilter(option.id)} accessibilityRole="button" accessibilityState={{ selected: filter === option.id }} style={[styles.filter, filter === option.id && styles.selected]}><Text style={[styles.filterText, filter === option.id && styles.selectedText]}>{option.label}</Text></Pressable>)}</ScrollView>
    {filter === 'custom' ? <View style={styles.dateInputs}><View style={styles.inputGroup}><Text style={styles.label}>Nuo</Text><TextInput value={from} onChangeText={setFrom} placeholder="MMMM-MM-DD" placeholderTextColor="#8c8494" accessibilityLabel="Data nuo, metai mėnuo diena" style={styles.input} /></View><View style={styles.inputGroup}><Text style={styles.label}>Iki (nebūtina)</Text><TextInput value={to} onChangeText={setTo} placeholder="MMMM-MM-DD" placeholderTextColor="#8c8494" accessibilityLabel="Data iki, metai mėnuo diena" style={styles.input} /></View></View> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : <Text style={styles.count}>{visible.length} renginių</Text>}
  </View>} ListEmptyComponent={!error ? <View style={styles.empty}><Text style={styles.emptyTitle}>Renginių neradome</Text><Text style={styles.venue}>Išbandykite kitą datų filtrą.</Text></View> : null} />;
}
const styles = StyleSheet.create({
  header: { paddingTop: 20, gap: 12 }, eyebrow: { color: '#ed7d83', fontSize: 11, fontWeight: '800', letterSpacing: 2 }, heading: { color: '#fff', fontSize: 38, lineHeight: 43, fontWeight: '800', letterSpacing: -1 }, intro: { color: '#b9b0bd', fontSize: 15, lineHeight: 22 }, filters: { gap: 8, paddingVertical: 8 }, filter: { borderColor: '#413742', borderWidth: 1, borderRadius: 30, paddingHorizontal: 16, paddingVertical: 10 }, selected: { backgroundColor: '#f0e8e7', borderColor: '#f0e8e7' }, filterText: { color: '#e4dbe3', fontSize: 14, fontWeight: '600' }, selectedText: { color: '#1b121b' }, count: { color: '#b9b0bd', fontSize: 13 }, card: { backgroundColor: '#201b24', borderRadius: 18, overflow: 'hidden' }, image: { width: '100%', height: 220, backgroundColor: '#302631' }, placeholder: { alignItems: 'center', justifyContent: 'center' }, placeholderText: { color: '#80616a', fontWeight: '900', letterSpacing: 4, fontSize: 20 }, cardBody: { padding: 18, gap: 8 }, date: { color: '#ee969b', fontSize: 13, fontWeight: '700' }, title: { color: '#fff', fontSize: 21, lineHeight: 27, fontWeight: '700' }, venue: { color: '#c5bac7', fontSize: 15, lineHeight: 21 }, artists: { color: '#a99dab', fontSize: 13, lineHeight: 19 }, link: { color: '#f1c6c7', fontSize: 13, fontWeight: '700', paddingTop: 6 }, empty: { paddingVertical: 48, alignItems: 'center', gap: 8 }, emptyTitle: { color: '#fff', fontSize: 19, fontWeight: '700' }, dateInputs: { flexDirection: 'row', gap: 10 }, inputGroup: { flex: 1, gap: 6 }, label: { color: '#ded4df', fontSize: 13 }, input: { color: '#fff', borderWidth: 1, borderColor: '#554a57', borderRadius: 10, padding: 12 }, error: { color: '#ffaaaa', fontSize: 13, lineHeight: 19 },
});
