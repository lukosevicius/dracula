import { Image } from 'expo-image';
import { Link, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { WebHeader } from '../components/web-header';
import { BottomNav } from '../components/bottom-nav';
import { AuthProvider } from '../auth/auth-context';
import { SavedEventsProvider, useSavedEvents } from '../utils/saved-events';
import { FollowedArtistsProvider } from '../utils/followed-artists';
import { PullToRefresh } from '../components/pull-to-refresh';
import { CityPicker, CityProvider } from '../components/city-picker';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect } from 'react';
import { startAnalytics } from '../utils/analytics';

function BrandTitle() {
  return <Link href="/" asChild><Pressable accessibilityRole="link" accessibilityLabel="Dracula – pagrindinis puslapis" style={styles.brand}>
    <Image source={require('../../assets/images/dracula-logo.png')} style={styles.logo} contentFit="contain" accessibilityIgnoresInvertColors />
    <Text style={styles.brandName}>Dracula</Text>
  </Pressable></Link>;
}
function HeaderLeft() {
  return <View style={styles.headerLeft}><BrandTitle /><CityPicker /></View>;
}
function AppLayout() {
  const { error, retry } = useSavedEvents();
  useEffect(() => { startAnalytics(); }, []);
  return <View style={{ flex: 1, backgroundColor: '#100e15' }}><StatusBar style="light" /><PullToRefresh />
    <View style={{ flex: 1 }}><Stack screenOptions={{ headerStyle: { backgroundColor: '#100e15' }, headerTintColor: '#fff', headerShadowVisible: false, contentStyle: { backgroundColor: '#100e15' }, header: process.env.EXPO_OS === 'web' ? () => <WebHeader><HeaderLeft /></WebHeader> : undefined, headerTitle: () => <HeaderLeft /> }} /></View>
    {error ? <View style={{ alignItems: 'center' }}><Text accessibilityRole="alert" style={styles.error}>Nepavyko sinchronizuoti išsaugotų renginių.</Text><Pressable accessibilityRole="button" onPress={retry}><Text style={styles.error}>Bandyti dar kartą</Text></Pressable></View> : null}
    <BottomNav />
  </View>;
}
export default function RootLayout() { return <AuthProvider><SavedEventsProvider><FollowedArtistsProvider><CityProvider><AppLayout /></CityProvider></FollowedArtistsProvider></SavedEventsProvider></AuthProvider>; }
const styles = StyleSheet.create({ brand: { flexDirection: 'row', alignItems: 'center', gap: 10 }, headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 }, logo: { width: 46, height: 46, borderRadius: 8 }, brandName: { color: '#fff', fontSize: 18, fontWeight: '700' }, error: { color: '#ffaaaa', textAlign: 'center', padding: 8 } });
