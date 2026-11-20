import { Image } from 'expo-image';
import { Link, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { WebHeader } from '../components/web-header';
import { BottomNav } from '../components/bottom-nav';
import { AuthProvider } from '../auth/auth-context';
import { SavedEventsProvider, useSavedEvents } from '../utils/saved-events';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function BrandTitle() {
  return <Link href="/" asChild><Pressable accessibilityRole="link" accessibilityLabel="Dracula – pagrindinis puslapis" style={styles.brand}>
    <Image source={require('../../assets/images/dracula-logo.png')} style={styles.logo} contentFit="contain" accessibilityIgnoresInvertColors />
    <Text style={styles.brandName}>Dracula</Text>
  </Pressable></Link>;
}
function AppLayout() {
  const { error, retry } = useSavedEvents();
  return <View style={{ flex: 1, backgroundColor: '#100e15' }}><StatusBar style="light" />
    <View style={{ flex: 1 }}><Stack screenOptions={{ headerStyle: { backgroundColor: '#100e15' }, headerTintColor: '#fff', headerShadowVisible: false, contentStyle: { backgroundColor: '#100e15' }, header: process.env.EXPO_OS === 'web' ? () => <WebHeader><BrandTitle /></WebHeader> : undefined, headerTitle: () => <BrandTitle /> }} /></View>
    {error ? <View style={{ alignItems: 'center' }}><Text accessibilityRole="alert" style={styles.error}>Nepavyko sinchronizuoti išsaugotų renginių.</Text><Pressable accessibilityRole="button" onPress={retry}><Text style={styles.error}>Bandyti dar kartą</Text></Pressable></View> : null}
    <BottomNav />
  </View>;
}
export default function RootLayout() { return <AuthProvider><SavedEventsProvider><AppLayout /></SavedEventsProvider></AuthProvider>; }
const styles = StyleSheet.create({ brand: { flexDirection: 'row', alignItems: 'center', gap: 10 }, logo: { width: 46, height: 46, borderRadius: 8 }, brandName: { color: '#fff', fontSize: 18, fontWeight: '700' }, error: { color: '#ffaaaa', textAlign: 'center', padding: 8 } });
