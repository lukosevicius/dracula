import { createContext, useContext, useState, type ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { cityPickerEnabled } from '../constants/features';

export const cities = ['Visi', 'Vilnius', 'Kaunas', 'Klaipėda', 'Palanga'] as const;
export type City = typeof cities[number];

const CityContext = createContext<{ city: City; setCity: (city: City) => void }>({ city: 'Visi', setCity: () => {} });

/** The city lives above the screens because its picker sits in the shared header. */
export function CityProvider({ children }: { children: ReactNode }) {
  const [city, setCity] = useState<City>('Visi');
  return <CityContext.Provider value={{ city, setCity }}>{children}</CityContext.Provider>;
}

export const useCity = () => useContext(CityContext);

/** Shown next to the logo, only on the event list where it applies. */
export function CityPicker() {
  const { city, setCity } = useCity();
  const [open, setOpen] = useState(false);
  if (usePathname() !== '/' || !cityPickerEnabled) return null;
  return <View style={styles.picker}>
    <Pressable onPress={() => setOpen(value => !value)} accessibilityRole="button" accessibilityLabel={`Miestas: ${city}`} aria-expanded={open} style={[styles.button, city !== 'Visi' && styles.buttonActive]}>
      <View style={styles.pin} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.pinDot} /></View>
      <Text style={styles.value}>{city === 'Visi' ? 'Visa Lietuva' : city}</Text>
      <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{open ? '▴' : '▾'}</Text>
    </Pressable>
    {open && <View accessibilityRole="radiogroup" accessibilityLabel="Pasirinkite miestą" style={styles.options}>
      {cities.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityLabel={option === 'Visi' ? 'Visa Lietuva' : option} aria-checked={city === option} onPress={() => { setCity(option); setOpen(false); }} style={[styles.option, city === option && styles.optionSelected]}>
        <Text style={styles.value}>{option === 'Visi' ? 'Visa Lietuva' : option}</Text>
        {city === option && <Text style={styles.selectedMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">✓</Text>}
      </Pressable>)}
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
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, minHeight: 44, borderRadius: 8 },
  optionSelected: { backgroundColor: '#372b37' },
  selectedMark: { color: '#ed7d83', fontSize: 15 },
});
