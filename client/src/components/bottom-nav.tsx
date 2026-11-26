import { Link, usePathname, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { artistsEnabled } from '../constants/features';
const tabs = [
  { href: '/', label: 'Visi', icon: '▦' },
  { href: '/saved', label: 'Išsaugoti', icon: '♡' },
  { href: '/following', label: 'Seku', icon: '#' },
] as const;
const visibleTabs = tabs.filter(tab => artistsEnabled || tab.href !== '/following');
export function BottomNav() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  if (width >= 700) return null;
  return <View nativeID="dracula-bottom-nav" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>{visibleTabs.map(tab => {
    const active = path === tab.href || (tab.href === '/' && path.startsWith('/events/'));
    return <Link href={tab.href as Href} asChild key={tab.href}><Pressable accessibilityRole="link" accessibilityState={{ selected: active }} style={styles.tab}><View style={[styles.iconWrap, active && styles.active]}><Text style={[styles.icon, tab.href === '/saved' && styles.heart, tab.href === '/following' && styles.hash]}>{tab.icon}</Text></View><Text style={[styles.label, active && styles.activeLabel]}>{tab.label}</Text></Pressable></Link>;
  })}</View>;
}
const styles = StyleSheet.create({ bar: { flexDirection: 'row', backgroundColor: '#151219', borderTopWidth: 1, borderTopColor: '#413742', paddingTop: 5 }, tab: { flex: 1, alignItems: 'center', gap: 2 }, iconWrap: { width: 62, height: 30, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, active: { backgroundColor: '#3a2938' }, icon: { color: '#d3b4ed', fontSize: 24, fontWeight: '700', lineHeight: 29 }, heart: { color: '#f379a0' }, hash: { color: '#ffc05c' }, label: { color: '#b2a8b4', fontSize: 11, fontWeight: '600' }, activeLabel: { color: '#fff' } });
