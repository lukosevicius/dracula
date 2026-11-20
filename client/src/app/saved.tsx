import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Link } from 'expo-router';
import { EventCard } from '../components/event-card';
import { useSavedEvents } from '../utils/saved-events';
export default function SavedPage() {
  const { events, error } = useSavedEvents();
  const { width } = useWindowDimensions();
  const columns = width >= 1100 ? 3 : width >= 700 ? 2 : 1;
  const padding = columns > 1 ? 32 : 18;
  const cardWidth = columns > 1 ? (Math.min(width, 1264) - padding * 2 - (columns - 1) * 20) / columns : undefined;
  return <FlatList key={columns} numColumns={columns} data={events} keyExtractor={item => String(item.id)} renderItem={({ item }) => <EventCard event={item} width={cardWidth} />} columnWrapperStyle={columns > 1 ? { gap: 20 } : undefined} contentContainerStyle={{ width: '100%', maxWidth: 1264, alignSelf: 'center', paddingHorizontal: padding, paddingBottom: 32, gap: 18 }} ListHeaderComponent={<View style={styles.header}><Text style={styles.eyebrow}>TAVO RENGINIAI</Text><Text style={styles.title}>Išsaugoti</Text><Text style={styles.copy}>Renginiai, kuriuos norisi prisiminti.</Text>{error ? <Text accessibilityRole="alert" style={styles.error}>Nepavyko pasiekti išsaugotų renginių. Patikrinkite įrenginio saugyklą.</Text> : null}</View>} ListEmptyComponent={!error ? <View style={styles.empty}><Text style={styles.emptyTitle}>Dar nėra išsaugotų renginių</Text><Text style={styles.copy}>Paspausk širdelę prie renginio, kad išsaugotum jį čia.</Text><Link href="/" style={styles.link}>Atrasti renginius →</Link></View> : null} />;
}
const styles = StyleSheet.create({ header: { paddingTop: 30, paddingBottom: 10, gap: 10 }, eyebrow: { color: '#ed7d83', fontSize: 11, fontWeight: '800', letterSpacing: 2 }, title: { color: '#fff', fontSize: 38, fontWeight: '800' }, copy: { color: '#b9b0bd', fontSize: 15, lineHeight: 22 }, empty: { paddingVertical: 48, alignItems: 'center', gap: 12 }, emptyTitle: { color: '#fff', fontSize: 19, fontWeight: '700', textAlign: 'center' }, link: { color: '#f1c6c7', fontWeight: '700', paddingTop: 6 }, error: { color: '#ffaaaa' } });
