import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { WebHeader } from '../components/web-header';
import { AuthProvider } from '../auth/auth-context';
import { StyleSheet, Text, View } from 'react-native';

function BrandTitle() {
  return <View style={styles.brand} accessibilityRole="header" accessibilityLabel="Dracula">
    <Image source={require('../../assets/images/dracula-logo.png')} style={styles.logo} contentFit="contain" accessibilityIgnoresInvertColors />
    <Text style={styles.brandName}>Dracula</Text>
  </View>;
}

export default function RootLayout() {
  return <AuthProvider><StatusBar style="light" /><Stack screenOptions={{ headerStyle: { backgroundColor: '#100e15' }, headerTintColor: '#fff', headerShadowVisible: false, contentStyle: { backgroundColor: '#100e15' } }}><Stack.Screen name="index" options={{ title: 'Dracula', header: process.env.EXPO_OS === 'web' ? () => <WebHeader><BrandTitle /></WebHeader> : undefined, headerTitle: () => <BrandTitle /> }} /></Stack></AuthProvider>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 46, height: 46, borderRadius: 8 },
  brandName: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
