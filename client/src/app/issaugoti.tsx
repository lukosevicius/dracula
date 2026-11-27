import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Link } from 'expo-router';
import { EventCard } from '../components/event-card';
import { useSavedEvents } from '../utils/saved-events';
import { savedEventRows } from '../utils/saved-groups';
import { vilniusDate } from '../shared/event-date-filters';
import { SiteFooter } from '../components/site-footer';
import { SignInNudge } from '../components/sign-in-nudge';
export default function SavedPage() {
  const { events, error, loading } = useSavedEvents();
  const { width } = useWindowDimensions();
  const columns = width >= 1400 ? 4 : width >= 1100 ? 3 : width >= 700 ? 2 : 1;
  const padding = columns > 1 ? 32 : 18;
  const cardWidth = Math.max(0, (Math.min(width, 1264) - padding * 2 - (columns - 1) * 20) / columns);
  const rows = savedEventRows(events, columns, vilniusDate());
  return <FlatList key={columns} data={rows} keyExtractor={item => item.key} renderItem={({ item }) => item.type === 'heading' ? <View style={styles.dayHeading} accessibilityRole="header"><Text style={styles.dayTitle}>{item.title}</Text></View> : <View style={styles.cardRow}>{item.events.map(event => <EventCard key={event.id} event={event} width={cardWidth} variant={columns > 1 ? 'large' : 'compact'} />)}</View>} contentContainerStyle={{ width: '100%', maxWidth: 1264, alignSelf: 'center', paddingHorizontal: padding, paddingBottom: 32, gap: 18 }} ListHeaderComponent={<View style={styles.header}><Text style={styles.eyebrow}>TAVO RENGINIAI</Text><Text style={styles.title}>Išsaugoti</Text><Text style={styles.copy}>Renginiai, kuriuos norisi prisiminti.</Text>{error ? <Text accessibilityRole="alert" style={styles.error}>Nepavyko įkelti išsaugotų renginių. Bandykite dar kartą.</Text> : null}<SignInNudge hasSaved={events.length > 0} /></View>} ListFooterComponent={<SiteFooter />} ListEmptyComponent={loading ? <Text style={styles.copy}>Kraunami išsaugoti renginiai...</Text> : !error ? <View style={styles.empty}><Text style={styles.emptyTitle}>Dar nėra išsaugotų renginių</Text><Text style={styles.copy}>Paspausk širdelę prie renginio, kad išsaugotum jį čia.</Text><Link href="/" style={styles.link}>Atrasti renginius →</Link></View> : null} />;
}
const styles = StyleSheet.create({ dayHeading: { borderBottomWidth: 1, borderBottomColor: '#413742', paddingBottom: 10, marginTop: 10 }, dayTitle: { color: '#fff', fontSize: 22, fontWeight: '800' }, cardRow: { flexDirection: 'row', gap: 20 }, header: { paddingTop: 30, paddingBottom: 10, gap: 10 }, eyebrow: { color: '#ed7d83', fontSize: 11, fontWeight: '800', letterSpacing: 2 }, title: { color: '#fff', fontSize: 38, fontWeight: '800' }, copy: { color: '#b9b0bd', fontSize: 15, lineHeight: 22 }, empty: { paddingVertical: 48, alignItems: 'center', gap: 12 }, emptyTitle: { color: '#fff', fontSize: 19, fontWeight: '700', textAlign: 'center' }, link: { color: '#f1c6c7', fontWeight: '700', paddingTop: 6 }, error: { color: '#ffaaaa' } });
