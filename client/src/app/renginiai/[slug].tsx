import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SaveButton } from '../../components/save-button';
import { CalendarButton } from '../../components/calendar-button';
import { displayText, eventLocation, eventSource, sameDayTimes, showtimeLines, eventPrice, shortDate } from '../../utils/event-format';
import { eventGroupLabel } from '../../utils/event-groups';
import { vilniusDate } from '../../shared/event-date-filters';
import { ShareButton } from '../../components/share-button';
import { fetchEvent, type DisplayEvent } from '../../utils/events-api';
import { artistsEnabled } from '../../constants/features';
import { SiteFooter } from '../../components/site-footer';
import { PageTitle } from '../../components/page-title';
import { eventIdFromSegment, eventSegment, eventUrl } from '../../utils/event-url';
import { eventDetails, track } from '../../utils/analytics';

export default function EventPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const id = eventIdFromSegment(slug);
  const [remoteEvent, setRemoteEvent] = useState<DisplayEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const event = String(remoteEvent?.id) === id ? remoteEvent : null;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
    const controller = new AbortController(); setRemoteEvent(null); setFailed(false); setLoading(true);
    if (!id) { setLoading(false); return () => controller.abort(); }
    fetchEvent(id, controller.signal).then(result => { if (!controller.signal.aborted) setRemoteEvent(result); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, retry]);
  // An outdated or missing name in the address is swapped for the current one, without a new history entry.
  const canonical = event ? eventSegment(event) : null;
  useEffect(() => {
    if (canonical && slug !== canonical) router.setParams({ slug: canonical });
  }, [canonical, slug]);

  if (loading) return <View style={styles.empty}><Stack.Screen options={{ title: 'Renginys' }} /><Text style={styles.value}>Kraunamas renginys...</Text></View>;
  if (failed) return <View style={styles.empty}><Stack.Screen options={{ title: 'Renginys' }} /><Text accessibilityRole="alert" style={styles.value}>Nepavyko įkelti renginio.</Text><Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)}><Text style={styles.link}>Bandyti dar kartą</Text></Pressable><Link href="/" style={styles.link}>Grįžti į renginius</Link></View>;

  if (!event) return <View style={styles.empty}><Stack.Screen options={{ title: 'Renginys' }} /><Text role="heading" aria-level={1} style={styles.title}>Renginio neradome</Text><Link href="/" style={styles.link}>Grįžti į renginius</Link></View>;

  const title = displayText(event.title);
  const location = eventLocation(event.venue, event.city);
  const image = event.image_url ? { uri: event.image_url } : undefined;
  const source = eventSource(event.about_url, event.source_url);
  const tickets = eventSource(null, event.ticket_url || '');
  const ends = event.event_end_date && event.event_end_date !== event.event_date ? event.event_end_date : null;
  const sameDay = sameDayTimes(event.times);
  const showings = showtimeLines(event.times);
  const time = showings.length ? null : sameDay ?? (event.event_time ? `${event.event_time}${event.event_end_time && event.event_end_time !== event.event_time ? `–${event.event_end_time}` : ''}` : null);
  // "Penktadienis, lapkr. 27 · 19:30", or "Šiandien" / "Rytoj" when it is that close.
  const day = event.event_date ? (ends ? `${shortDate(event.event_date)} – ${shortDate(ends)}` : `${eventGroupLabel(event.event_date, vilniusDate()).title}, ${shortDate(event.event_date)}`) : null;
  const when = [day, time].filter(Boolean).join(' · ');
  const price = eventPrice(event);
  const mapsUrl = location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}` : null;
  const pageUrl = eventUrl(event);

  async function openLink(url: string) {
    try { await Linking.openURL(url); }
    catch { Alert.alert('Nepavyko atidaryti nuorodos', 'Bandykite dar kartą.'); }
  }

  const poster = image && !imageFailed
    ? <View style={[styles.poster, desktop && styles.posterDesktop]}>
        {/* The blurred copy fills the frame, so the poster itself is shown whole rather than cropped. */}
        <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} accessible={false} />
        <View style={[StyleSheet.absoluteFill, styles.posterShade]} />
        <Image source={image} style={StyleSheet.absoluteFill} contentFit="contain" onError={() => setImageFailed(true)} accessibilityLabel={`Renginio ${title} nuotrauka`} />
      </View>
    : <View style={[styles.poster, desktop && styles.posterDesktop, styles.placeholder]}><Text style={styles.placeholderText}>DRACULA</Text></View>;

  return <View style={{ flex: 1 }}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.container, desktop && styles.containerDesktop, { paddingBottom: Math.max(insets.bottom, 32) }]}>
      <Stack.Screen options={{ title: 'Renginys', headerBackTitle: 'Renginiai' }} />
      <PageTitle title={`${title} · Dracula`} description={[event.event_date ? shortDate(event.event_date) : null, time, location, price].filter(Boolean).join(' · ') || undefined} />
      {desktop ? <Link href="/" style={styles.back}>← Visi renginiai</Link> : null}
      <View style={[styles.hero, desktop && styles.heroDesktop]}>
        {poster}
        <View style={[styles.summary, desktop && styles.summaryDesktop]}>
          <Text role="heading" aria-level={1} style={[styles.title, desktop && styles.titleDesktop]}>{title}</Text>
          <View style={styles.facts}>
            {when ? <Text style={styles.when}>{when}</Text> : null}
            {showings.map(line => <Text key={line} style={styles.fact}>{line}</Text>)}
            {location && mapsUrl ? <Pressable accessibilityRole="link" accessibilityLabel={`Vieta: ${location}, atidaryti žemėlapyje`} onPress={() => openLink(mapsUrl)} style={styles.placeLink}><Text style={styles.place}>{location}</Text></Pressable> : null}
            {/* Price, with the ticket link kept as quiet as the address link. */}
            {price || tickets ? <View style={styles.priceRow}>
              {price ? <Text style={styles.fact}>{price}</Text> : null}
              {price && tickets ? <Text style={styles.fact}>·</Text> : null}
              {tickets ? <Pressable accessibilityRole="link" accessibilityLabel={`Bilietai${price ? `, ${price}` : ''}`} onPress={() => { track('tickets_clicked', eventDetails(event)); void openLink(event.ticket_url!); }}><Text style={styles.place}>Bilietai</Text></Pressable> : null}
            </View> : null}
          </View>
          <View style={styles.secondary}><CalendarButton event={event} /><ShareButton title={title} url={pageUrl} /><SaveButton event={event} /></View>
          {artistsEnabled && event.artists.length ? <View style={styles.section}><Text role="heading" aria-level={2} style={styles.label}>ATLIKĖJAI</Text>{event.artists.map(artist => <Link key={artist.mbid} href={{pathname:'/artists/[id]',params:{id:artist.mbid}}} style={styles.link}>{displayText(artist.name)} →</Link>)}</View> : null}
        </View>
      </View>
      {event.description ? <View style={[styles.section, desktop && styles.descriptionDesktop]}><Text role="heading" aria-level={2} style={styles.label}>APIE RENGINĮ</Text><Text selectable style={styles.value}>{event.description}</Text></View> : null}
      {source ? <View style={[styles.section, desktop && { maxWidth: 760 }]}><Text role="heading" aria-level={2} style={styles.label}>RENGINIO NUORODA</Text><Pressable accessibilityRole="link" accessibilityLabel={`Atidaryti renginio nuorodą: ${source.label}`} onPress={() => { track('source_clicked', eventDetails(event)); void openLink(source.url); }}><Text style={styles.link}>{source.label}</Text></Pressable></View> : null}
      <SiteFooter />
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { padding: 18, gap: 18, width: '100%', alignSelf: 'center', maxWidth: 1264 },
  containerDesktop: { paddingHorizontal: 32, paddingTop: 32, gap: 40 },
  back: { color: '#f1c6c7', fontSize: 15, fontWeight: '700' },
  hero: { gap: 18 },
  heroDesktop: { flexDirection: 'row', gap: 44, alignItems: 'flex-start' },
  summary: { gap: 16 },
  summaryDesktop: { flex: 1, paddingVertical: 8, gap: 22 },
  poster: { width: '100%', height: 260, borderRadius: 18, overflow: 'hidden', backgroundColor: '#302631' },
  posterDesktop: { width: '50%', height: 480 },
  posterShade: { backgroundColor: '#100e15', opacity: 0.45 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: '#80616a', fontWeight: '900', letterSpacing: 4, fontSize: 20 },
  title: { color: '#fff', fontSize: 28, lineHeight: 34, fontWeight: '800' },
  titleDesktop: { fontSize: 42, lineHeight: 49, letterSpacing: -0.8 },
  facts: { gap: 6 },
  when: { color: '#ee969b', fontSize: 17, lineHeight: 24, fontWeight: '700' },
  fact: { color: '#e4dbe3', fontSize: 16, lineHeight: 23 },
  placeLink: { alignSelf: 'flex-start' },
  place: { color: '#e4dbe3', fontSize: 16, lineHeight: 23, textDecorationLine: 'underline', textDecorationColor: '#6d5f70' },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 },
  secondary: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  descriptionDesktop: { maxWidth: 760, paddingTop: 24, borderTopWidth: 1, borderTopColor: '#413742', gap: 16 },
  section: { gap: 7, paddingTop: 8 },
  label: { color: '#ed7d83', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  value: { color: '#e4dbe3', fontSize: 16, lineHeight: 23 },
  link: { color: '#f1c6c7', fontSize: 16, fontWeight: '700' },
  empty: { padding: 24, gap: 18 },
});
