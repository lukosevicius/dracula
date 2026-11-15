import { useState } from 'react';
import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PublicEvent } from '../../../../seeker/types';
import snapshot from '../../data/events.json';
import { eventImages } from '../../data/event-images';
import { CalendarButton } from '../../components/calendar-button';
import { displayDate, displayText, eventSource } from '../../utils/event-format';

const events: PublicEvent[] = snapshot;

export function generateStaticParams() {
  return events.map(event => ({ id: String(event.id) }));
}

export default function EventPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = events.find(item => String(item.id) === id);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const [imageFailed, setImageFailed] = useState(false);

  if (!event) return <View style={styles.empty}><Stack.Screen options={{ title: 'Renginys' }} /><Text style={styles.title}>Renginio neradome</Text><Link href="/" style={styles.link}>Grįžti į renginius</Link></View>;

  const title = displayText(event.title);
  const image = event.image == null ? undefined : eventImages[event.image];
  const source = eventSource(event.about_url, event.source_url);
  const date = `${displayDate(event.event_date)}${event.event_end_date && event.event_end_date !== event.event_date ? ` – ${displayDate(event.event_end_date)}` : ''}${event.event_time ? ` · ${event.event_time}` : ''}`;

  async function openLink(url: string) {
    try { await Linking.openURL(url); }
    catch { Alert.alert('Nepavyko atidaryti nuorodos', 'Bandykite dar kartą.'); }
  }

  const links = <>
    {eventSource(null, event.ticket_url || '') ? <View style={styles.section}><Text style={styles.label}>BILIETAI</Text><Pressable accessibilityRole="link" onPress={() => openLink(event.ticket_url!)}><Text style={styles.link}>Įsigyti bilietus ↗</Text></Pressable></View> : null}
    {source ? <View style={styles.section}><Text style={styles.label}>RENGINIO NUORODA</Text><Pressable accessibilityRole="link" accessibilityLabel={`Atidaryti renginio nuorodą: ${source.label}`} onPress={() => openLink(source.url)}><Text style={styles.link}>{source.label} ↗</Text></Pressable></View> : null}
  </>;

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.container, desktop && styles.containerDesktop, { paddingBottom: Math.max(insets.bottom, 32) }]}>
    <Stack.Screen options={{ title: 'Renginys', headerBackTitle: 'Renginiai' }} />
    <View style={[styles.hero, desktop && styles.heroDesktop]}>
      {image && !imageFailed ? <Image source={image} style={[styles.image, desktop && styles.imageDesktop]} contentFit="cover" onError={() => setImageFailed(true)} accessibilityLabel={`Renginio ${title} nuotrauka`} /> : <View style={[styles.image, desktop && styles.imageDesktop, styles.placeholder]}><Text style={styles.placeholderText}>DRACULA</Text></View>}
      <View style={[styles.summary, desktop && styles.summaryDesktop]}>
        <Text style={styles.date}>{date}</Text>
        <Text style={[styles.title, desktop && styles.titleDesktop]}>{title}</Text>
        <CalendarButton event={event} />
        {event.venue ? <View style={styles.section}><Text style={styles.label}>VIETA</Text><Text style={styles.value}>{displayText(event.venue)}</Text></View> : null}
        {event.artists.length ? <View style={styles.section}><Text style={styles.label}>ATLIKĖJAI</Text><Text style={styles.value}>{event.artists.map(artist => displayText(artist.name)).join(' · ')}</Text></View> : null}
        {desktop ? links : null}
      </View>
    </View>
    {event.description ? <View style={[styles.section, desktop && styles.descriptionDesktop]}><Text style={styles.label}>APIE RENGINĮ</Text><Text selectable style={styles.value}>{event.description}</Text></View> : null}
    {!desktop ? links : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { padding: 18, gap: 16, width: '100%', alignSelf: 'center', maxWidth: 1264 },
  containerDesktop: { paddingHorizontal: 32, paddingTop: 48, gap: 48 },
  hero: { gap: 16 },
  heroDesktop: { flexDirection: 'row', gap: 44, alignItems: 'flex-start' },
  summary: { gap: 16 },
  summaryDesktop: { flex: 1, paddingVertical: 8, gap: 18 },
  imageDesktop: { width: '50%', height: 480 },
  titleDesktop: { fontSize: 42, lineHeight: 49, letterSpacing: -0.8 },
  descriptionDesktop: { maxWidth: 760, paddingTop: 24, borderTopWidth: 1, borderTopColor: '#413742', gap: 16 },
  image: { width: '100%', height: 260, borderRadius: 18, backgroundColor: '#302631' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: '#80616a', fontWeight: '900', letterSpacing: 4, fontSize: 20 },
  date: { color: '#ee969b', fontSize: 14, fontWeight: '700' },
  title: { color: '#fff', fontSize: 30, lineHeight: 37, fontWeight: '800' },
  section: { gap: 7, paddingTop: 8 },
  label: { color: '#ed7d83', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  value: { color: '#e4dbe3', fontSize: 16, lineHeight: 23 },
  link: { color: '#f1c6c7', fontSize: 16, fontWeight: '700' },
  empty: { padding: 24, gap: 18 },
});
