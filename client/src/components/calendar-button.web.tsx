import { Pressable, StyleSheet, Text } from 'react-native';
import type { DisplayEvent } from '../utils/events-api';
import { calendarFile, hasCalendarTime } from '../utils/calendar';
import { eventDetails, track } from '../utils/analytics';

export function CalendarButton({ event }: { event: DisplayEvent }) {
  if (!event.event_date || !hasCalendarTime(event.event_time)) return null;
  function download() {
    const content = calendarFile(event);
    if (!content) return;
    track('calendar_added', eventDetails(event));
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `dracula-event-${event.id}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Pressable accessibilityRole="button" onPress={download} accessibilityLabel="Pridėti į kalendorių" style={styles.button}><Text style={styles.label}>Į kalendorių</Text></Pressable>;
}
const styles = StyleSheet.create({ button: { height: 44, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: '#554a57', paddingHorizontal: 16 }, label: { color: '#f4e9ed', fontSize: 14, fontWeight: '700' } });
