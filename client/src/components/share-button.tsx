import { useState } from 'react';
import { Pressable, Share, StyleSheet, Text } from 'react-native';
import { track } from '../utils/analytics';

/** Copies on the web: the Clipboard API first, then the older selection copy where that is blocked. */
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fall back below. */ }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { field.remove(); }
}

/** Opens the phone's share sheet; where the browser has none, copies the link instead. */
export function ShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { share?: unknown };
    if (process.env.EXPO_OS === 'web' && !nav?.share) {
      if (await copy(url)) { track('event_shared', { url, method: 'copy' }); setCopied(true); setTimeout(() => setCopied(false), 2000); }
      return;
    }
    track('event_shared', { url, method: 'share' });
    try { await Share.share(process.env.EXPO_OS === 'ios' ? { title, url } : { title, message: process.env.EXPO_OS === 'web' ? url : `${title}\n${url}`, url }); }
    catch { /* Closing the share sheet is not an error worth showing. */ }
  }
  return <Pressable accessibilityRole="button" accessibilityLabel={copied ? 'Nuoroda nukopijuota' : 'Dalintis renginiu'} onPress={() => void share()} style={styles.button}>
    <Text style={styles.label}>{copied ? 'Nukopijuota ✓' : 'Dalintis'}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({ button: { height: 44, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: '#554a57', paddingHorizontal: 16 }, label: { color: '#f4e9ed', fontSize: 14, fontWeight: '700' } });
