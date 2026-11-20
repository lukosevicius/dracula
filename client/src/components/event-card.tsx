import { useState } from 'react';
import { Link } from 'expo-router';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { displayDate, displayText } from '../utils/event-format';
import type { DisplayEvent } from '../utils/events-api';
import { SaveButton } from './save-button';
export function EventCard({ event, width }: { event: DisplayEvent; width?: number }) {
  const [failed, setFailed] = useState(false);
  const title = displayText(event.title);
  const source = event.image_url ? { uri: event.image_url } : undefined;
  return <View style={[styles.card, width != null && { width }]}><Link href={{ pathname: '/events/[id]', params: { id: String(event.id) } }} asChild>
    <Pressable accessibilityRole="link" accessibilityLabel={`${title}, atidaryti renginio puslapį`}>
    {source && !failed ? <Image source={source} style={styles.image} contentFit="cover" onError={() => setFailed(true)} accessibilityLabel={`Renginio ${title} nuotrauka`} /> : <View style={[styles.image, styles.placeholder]}><Text style={styles.placeholderText}>DRACULA</Text></View>}
    <View style={styles.cardBody}>
      <Text style={styles.date}>{displayDate(event.event_date)}{event.event_end_date && event.event_end_date !== event.event_date ? ` – ${displayDate(event.event_end_date)}` : ''}{event.event_time ? ` · ${event.event_time}` : ''}</Text>
      <Text style={styles.title}>{title}</Text>
      {event.venue ? <Text style={styles.venue}>{displayText(event.venue)}</Text> : null}
      {event.artists.length ? <Text style={styles.artists}>{event.artists.map(a => displayText(a.name)).join(' · ')}</Text> : null}
      <Text style={styles.link}>Daugiau apie renginį →</Text>
    </View>
  </Pressable></Link><SaveButton event={event} overlay /></View>;
}

const styles = StyleSheet.create({
 card: { backgroundColor: '#201b24', borderRadius: 18, overflow: 'hidden' }, image: { width: '100%', height: 220, backgroundColor: '#302631' }, placeholder: { alignItems: 'center', justifyContent: 'center' }, placeholderText: { color: '#80616a', fontWeight: '900', letterSpacing: 4, fontSize: 20 }, cardBody: { padding: 18, gap: 8 }, date: { color: '#ee969b', fontSize: 13, fontWeight: '700' }, title: { color: '#fff', fontSize: 21, lineHeight: 27, fontWeight: '700' }, venue: { color: '#c5bac7', fontSize: 15, lineHeight: 21 }, artists: { color: '#a99dab', fontSize: 13, lineHeight: 19 }, link: { color: '#f1c6c7', fontSize: 13, fontWeight: '700', paddingTop: 6 }
});
