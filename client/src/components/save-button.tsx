import { Pressable, StyleSheet, Text } from 'react-native';
import type { DisplayEvent } from '../utils/events-api';
import { useSavedEvents } from '../utils/saved-events';
import { track } from '../utils/analytics';
export function SaveButton({ event, overlay = false, compact = false }: { event: DisplayEvent; overlay?: boolean; compact?: boolean }) {
  const { events, toggle, loading, error } = useSavedEvents();
  const saved = events.some(item => item.id === event.id);
  return <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Pašalinti iš išsaugotų renginių' : 'Išsaugoti renginį'} disabled={loading || error} accessibilityState={{ selected: saved, disabled: loading || error }} onPress={() => { track(saved ? 'event_unsaved' : 'event_saved', { event_id: event.id }); toggle(event); }} style={[styles.button, overlay && styles.overlay, compact && styles.compact]}><Text style={[styles.heart, compact && styles.compactHeart, saved && styles.saved]}>{saved ? '♥' : '♡'}</Text></Pressable>;
}
const styles = StyleSheet.create({ button: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#211922', borderWidth: 1, borderColor: '#66515d', alignItems: 'center', justifyContent: 'center' }, overlay: { position: 'absolute', right: 12, top: 12 }, heart: { color: '#fff', fontSize: 27, lineHeight: 32 }, saved: { color: '#f37991' }, compact: { backgroundColor: 'transparent', borderWidth: 0 }, compactHeart: { fontSize: 24, lineHeight: 28 } });
