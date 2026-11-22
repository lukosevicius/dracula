import { Pressable, StyleSheet, Text } from 'react-native';
import type { DisplayEvent } from '../utils/events-api';
import { calendarFile, hasCalendarTime } from '../utils/calendar';

export function CalendarButton({ event }: { event: DisplayEvent }) {
  if (!event.event_date || !hasCalendarTime(event.event_time)) return null;
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
  return <Pressable accessibilityRole="button" onPress={download} style={styles.button}><Text style={styles.label}>Pridėti į kalendorių</Text></Pressable>;
}
const styles = StyleSheet.create({ button: { backgroundColor: '#f0e8e7', borderRadius: 30, paddingHorizontal: 18, paddingVertical: 12 }, label: { color: '#1b121b', fontSize: 15, fontWeight: '700' } });
