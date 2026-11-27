import { useState } from 'react';
import { Link } from 'expo-router';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { displayText, eventLocation, eventPrice, sameDayTimes, shortDate, showtimeLines } from '../utils/event-format';
import type { DisplayEvent } from '../utils/events-api';
import { SaveButton } from './save-button';
import { artistsEnabled } from '../constants/features';

type Props = {
  event: DisplayEvent;
  width?: number;
  /** Compact rows show a small poster beside the text, so more events fit on a phone screen. */
  variant?: 'large' | 'compact';
  /** Inside a day group the date is already in the heading, so only the time (and an end date) is shown. */
  hideDate?: boolean;
};

export function EventCard({ event, width, variant = 'large', hideDate = false }: Props) {
  const [failed, setFailed] = useState(false);
  // A pointer hovering a card lifts it slightly, so it reads as clickable on desktop.
  const [hovered, setHovered] = useState(false);
  const compact = variant === 'compact';
  // Narrower cards (four columns on wide screens) get a shorter image, so a row is not all poster.
  const imageHeight = width != null ? Math.min(220, Math.max(170, Math.round(width * 0.62))) : 220;
  const title = displayText(event.title);
  const location = eventLocation(event.venue, event.city);
  const source = event.image_url ? { uri: event.image_url } : undefined;
  const price = eventPrice(event);
  // One card per event; several showings are listed with it rather than as separate events.
  const times = sameDayTimes(event.times) ?? (showtimeLines(event.times).length ? 'keli laikai' : event.event_time);
  const ends = event.event_end_date && event.event_end_date !== event.event_date ? event.event_end_date : null;
  const date = hideDate ? (ends ? `iki ${shortDate(ends)}` : '') : `${shortDate(event.event_date)}${ends ? ` – ${shortDate(ends)}` : ''}`;
  const meta = [date, times].filter(Boolean).join(' · ');
  const image = source && !failed
    ? <Image source={source} style={compact ? styles.thumb : [styles.image, { height: imageHeight }]} contentFit="cover" onError={() => setFailed(true)} accessibilityLabel={`Renginio ${title} nuotrauka`} />
    : <View style={[compact ? styles.thumb : [styles.image, { height: imageHeight }], styles.placeholder]}><Text style={compact ? styles.placeholderSmall : styles.placeholderText}>{compact ? 'D' : 'DRACULA'}</Text></View>;
  const priceChip = price ? <View style={[styles.price, price === 'Nemokamai' && styles.free]}><Text style={[styles.priceText, price === 'Nemokamai' && styles.freeText]}>{price}</Text></View> : null;
  const link = (children: React.ReactNode, style?: object) => <Link href={{ pathname: '/events/[id]', params: { id: String(event.id) } }} asChild>
    <Pressable accessibilityRole="link" accessibilityLabel={`${title}, atidaryti renginio puslapį`} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={style}>{children}</Pressable>
  </Link>;

  if (compact) return <View style={[styles.card, styles.compactCard, hovered && styles.hovered, width != null && { width }]}>
    {link(<>
      {image}
      <View style={styles.compactBody}>
        {meta || priceChip ? <View style={styles.metaRow}>{meta ? <Text style={styles.date} numberOfLines={1}>{meta}</Text> : null}{priceChip}</View> : null}
        <Text style={styles.compactTitle} numberOfLines={2}>{title}</Text>
        {location ? <Text style={styles.compactVenue} numberOfLines={1}>{location}</Text> : null}
      </View>
    </>, styles.compactLink)}
    <SaveButton event={event} compact />
  </View>;

  return <View style={[styles.card, hovered && styles.hovered, hovered && styles.lifted, width != null && { width }]}>{link(<>
    {image}
    <View style={styles.cardBody}>
      {meta || priceChip ? <View style={styles.metaRow}>{meta ? <Text style={styles.date}>{meta}</Text> : null}{priceChip}</View> : null}
      <Text style={styles.title}>{title}</Text>
      {location ? <Text style={styles.venue}>{location}</Text> : null}
      {artistsEnabled && event.artists.length ? <Text style={styles.artists}>{event.artists.map(a => displayText(a.name)).join(' · ')}</Text> : null}
    </View>
  </>)}<SaveButton event={event} overlay /></View>;
}

const styles = StyleSheet.create({
  // The transition is a web-only style; native platforms do not accept it.
  card: { backgroundColor: '#201b24', borderRadius: 18, overflow: 'hidden', ...(process.env.EXPO_OS === 'web' ? { transitionDuration: '150ms', transitionProperty: 'transform, background-color' } : {}) },
  hovered: { backgroundColor: '#2a232f' },
  lifted: { transform: [{ translateY: -3 }] },
  image: { width: '100%', height: 220, backgroundColor: '#302631' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderText: { color: '#80616a', fontWeight: '900', letterSpacing: 4, fontSize: 20 },
  placeholderSmall: { color: '#80616a', fontWeight: '900', fontSize: 22 },
  cardBody: { padding: 16, gap: 6 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4 },
  date: { color: '#ee969b', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  price: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: '#302a33' },
  priceText: { color: '#e4dbe3', fontSize: 12, fontWeight: '700' },
  free: { backgroundColor: '#1f3a2c' },
  freeText: { color: '#9fe0b8' },
  title: { color: '#fff', fontSize: 20, lineHeight: 26, fontWeight: '700' },
  venue: { color: '#c5bac7', fontSize: 15, lineHeight: 21 },
  artists: { color: '#a99dab', fontSize: 13, lineHeight: 19 },
  compactCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingRight: 4 },
  compactLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8 },
  thumb: { width: 72, height: 90, borderRadius: 10, backgroundColor: '#302631' },
  compactBody: { flex: 1, minWidth: 0, gap: 4 },
  compactTitle: { color: '#fff', fontSize: 16, lineHeight: 21, fontWeight: '700' },
  compactVenue: { color: '#c5bac7', fontSize: 13, lineHeight: 18 },
});
