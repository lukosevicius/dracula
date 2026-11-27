import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

/** A quiet line at the end of a page's content. It scrolls with the page, so it never covers the bottom navigation. */
export function SiteFooter() {
  return <View style={styles.footer}>
    <Text style={styles.text}>
      <Link href="/privatumas" style={styles.link}>Privatumas</Link>
      <Text style={styles.separator}>  ·  </Text>
      <Link href="mailto:info@dracula.lt" style={styles.link}>info@dracula.lt</Link>
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  footer: { alignItems: 'center', paddingTop: 36, paddingBottom: 12, marginTop: 12, borderTopWidth: 1, borderTopColor: '#2a232d' },
  text: { color: '#8f8493', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  link: { color: '#a99dab', fontSize: 13 },
  separator: { color: '#5d5361' },
});
