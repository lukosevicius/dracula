import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DisplayEvent } from '../utils/events-api';
import { calendarFile } from '../utils/calendar';

export function CalendarButton({ event }: { event: DisplayEvent }) {
  if (!event.event_date) return null;
  function download() {
    const content = calendarFile(event);
    if (!content) return;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `dracula-event-${event.id}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <View style={styles.container}><Pressable accessibilityRole="button" onPress={download} style={styles.button}><Text style={styles.label}>Pridėti į kalendorių</Text></Pressable>{event.event_time ? <Text style={styles.note}>Pabaigos laikas nežinomas — patikrinkite jį kalendoriuje.</Text> : <Text style={styles.note}>Laikas nežinomas — renginys bus pridėtas visai dienai.</Text>}</View>;
}
const styles = StyleSheet.create({ container: { gap: 7, alignItems: 'flex-start' }, button: { backgroundColor: '#f0e8e7', borderRadius: 30, paddingHorizontal: 18, paddingVertical: 12 }, label: { color: '#1b121b', fontSize: 15, fontWeight: '700' }, note: { color: '#b9b0bd', fontSize: 13, lineHeight: 19 } });
