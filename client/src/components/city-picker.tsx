import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cityPickerEnabled } from '../constants/features';
import { apiUrl } from '../utils/events-api';

/** "Visi" means all of Lithuania. */
export const allCities = 'Visi';
export const defaultCity = 'Vilnius';
const storageKey = 'dracula.city';
const guessTimeoutMs = 1500;

type CityCount = { city: string; events: number };
type CityState = { city: string | null; cities: CityCount[]; setCity: (city: string) => void };
const CityContext = createContext<CityState>({ city: defaultCity, cities: [], setCity: () => {} });

function storedCity(): string | null {
  if (Platform.OS !== 'web') return null;
  try { return localStorage.getItem(storageKey); } catch { return null; }
}
function rememberCity(city: string) {
  if (Platform.OS !== 'web') return;
  try { localStorage.setItem(storageKey, city); } catch { /* Not remembered this time. */ }
}

/**
 * Which city's events the list shows. A remembered choice applies at once. On a first visit the API's guess from
 * the visitor's IP address is used (Vilnius when there is none), and the list waits for it briefly so it does not
 * load one city and then jump to another. The city lives above the screens because its picker sits in the header.
 */
export function CityProvider({ children }: { children: ReactNode }) {
  const [city, setCityState] = useState<string | null>(() => storedCity());
  const [cities, setCities] = useState<CityCount[]>([]);
  useEffect(() => {
    let settled = city !== null;
    const decide = (choice: string, remember: boolean) => {
      if (settled) return;
      settled = true;
      setCityState(choice);
      if (remember) rememberCity(choice);
    };
    const timer = setTimeout(() => decide(defaultCity, false), guessTimeoutMs);
    const controller = new AbortController();
    fetch(`${apiUrl}/v1/cities`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`API returned ${response.status}`)))
      .then((body: { cities?: CityCount[]; guess?: string | null }) => {
        const list = Array.isArray(body.cities) ? body.cities.filter(entry => typeof entry?.city === 'string' && entry.city) : [];
        setCities(list);
        decide(body.guess && list.some(entry => entry.city === body.guess) ? body.guess : defaultCity, true);
      })
      .catch(() => decide(defaultCity, false))
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  // Runs once: later choices come from the picker.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setCity = useCallback((choice: string) => { setCityState(choice); rememberCity(choice); }, []);
  return <CityContext.Provider value={{ city, cities, setCity }}>{children}</CityContext.Provider>;
}

export const useCity = () => useContext(CityContext);

const label = (city: string) => city === allCities ? 'Visa Lietuva' : city;

/** Shown next to the logo, only on the event list where it applies. Lists the cities that have upcoming events. */
export function CityPicker() {
  const { city, cities, setCity } = useCity();
  const [open, setOpen] = useState(false);
  if (usePathname() !== '/' || !cityPickerEnabled || city === null) return null;
  const options = [allCities, ...cities.map(entry => entry.city)];
  if (!options.includes(city)) options.splice(1, 0, city);
  return <View style={styles.picker}>
    <Pressable onPress={() => setOpen(value => !value)} accessibilityRole="button" accessibilityLabel={`Miestas: ${label(city)}`} aria-expanded={open} style={[styles.button, styles.buttonActive]}>
      <View style={styles.pin} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.pinDot} /></View>
      <Text style={styles.value}>{label(city)}</Text>
      <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{open ? '▴' : '▾'}</Text>
    </Pressable>
    {open && <View accessibilityRole="radiogroup" accessibilityLabel="Pasirinkite miestą" style={styles.options}>
      <ScrollView style={styles.optionList}>
        {options.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityLabel={label(option)} aria-checked={city === option} onPress={() => { setCity(option); setOpen(false); }} style={[styles.option, city === option && styles.optionSelected]}>
          <Text style={styles.value}>{label(option)}</Text>
          {city === option && <Text style={styles.selectedMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">✓</Text>}
        </Pressable>)}
      </ScrollView>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  picker: { position: 'relative', zIndex: 20 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, height: 38, borderRadius: 19, backgroundColor: '#241e28' },
  buttonActive: { borderWidth: 1, borderColor: '#ed7d83' },
  pin: { width: 11, height: 11, borderRadius: 6, borderBottomRightRadius: 0, borderWidth: 1.6, borderColor: '#c5bac7', transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center' },
  pinDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#c5bac7' },
  value: { color: '#fff', fontSize: 14, fontWeight: '700' },
  chevron: { color: '#b9b0bd', fontSize: 12 },
  options: { position: 'absolute', top: 44, left: 0, minWidth: 170, padding: 4, borderWidth: 1, borderColor: '#554a57', borderRadius: 12, backgroundColor: '#201b24', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  optionList: { maxHeight: 360 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, minHeight: 44, borderRadius: 8 },
  optionSelected: { backgroundColor: '#372b37' },
  selectedMark: { color: '#ed7d83', fontSize: 15 },
});
