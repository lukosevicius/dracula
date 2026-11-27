import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { openSignIn } from '../auth/open-sign-in';

const dismissedKey = 'dracula.signInNudgeDismissed';

function wasDismissed() {
  try { return globalThis.localStorage?.getItem(dismissedKey) === '1'; } catch { return false; }
}

/**
 * Saving works without an account, but then the list lives only in this browser.
 * Once someone has saved something, suggest signing in so the list is kept and follows them; they can hide this for good.
 */
export function SignInNudge({ hasSaved }: { hasSaved: boolean }) {
  const { state } = useAuth();
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (Platform.OS !== 'web' || state !== 'signed-out' || !hasSaved || dismissed) return null;
  function dismiss() {
    setDismissed(true);
    try { globalThis.localStorage?.setItem(dismissedKey, '1'); } catch { /* Hidden for this visit only. */ }
  }
  return <View style={styles.card} accessibilityRole="summary">
    <Pressable accessibilityRole="button" accessibilityLabel="Paslėpti" onPress={dismiss} style={styles.close} hitSlop={8}><Text style={styles.closeText}>×</Text></Pressable>
    <Text style={styles.title}>Neprarask savo renginių</Text>
    <Text style={styles.copy}>Kol neprisijungęs, išsaugoti renginiai lieka tik šioje naršyklėje. Prisijunk, kad jie neprapultų ir būtų matomi visuose tavo įrenginiuose.</Text>
    <Pressable accessibilityRole="button" onPress={openSignIn} style={styles.button}><Text style={styles.buttonText}>Prisijungti</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { marginTop: 8, padding: 18, paddingRight: 44, gap: 8, borderRadius: 14, borderWidth: 1, borderColor: '#413742', backgroundColor: '#1a151d' },
  close: { position: 'absolute', top: 8, right: 10, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#8f8493', fontSize: 22, lineHeight: 24 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  copy: { color: '#b9b0bd', fontSize: 15, lineHeight: 22, maxWidth: 560 },
  button: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: '#f1c6c7' },
  buttonText: { color: '#100e15', fontSize: 15, fontWeight: '700' },
});
