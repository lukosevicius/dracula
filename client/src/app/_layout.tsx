import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return <><StatusBar style="light" /><Stack screenOptions={{ headerStyle: { backgroundColor: '#100e15' }, headerTintColor: '#fff', headerShadowVisible: false, contentStyle: { backgroundColor: '#100e15' } }}><Stack.Screen name="index" options={{ title: 'Dracula' }} /></Stack></>;
}
