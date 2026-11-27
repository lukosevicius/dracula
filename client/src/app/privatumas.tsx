import { Link, Stack } from 'expo-router';
import { PageTitle } from '../components/page-title';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

/** Plain-language privacy policy. Keep it in step with what the API and app actually store. */
const privacyEmail = 'info@dracula.lt';
const updated = '2026 m. lapkričio 27 d.';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.section}><Text role="heading" aria-level={2} style={styles.subheading}>{title}</Text>{children}</View>;
}
function P({ children }: { children: ReactNode }) { return <Text style={styles.text}>{children}</Text>; }
function Email() { return <Link href={`mailto:${privacyEmail}`} style={styles.link}>{privacyEmail}</Link>; }

export default function PrivacyPage() {
  return <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
    <Stack.Screen options={{ title: 'Privatumas', headerBackTitle: 'Renginiai' }} />
    <PageTitle title="Privatumas · Dracula" description="Kaip Dracula tvarko jūsų duomenis: paskyra, išsaugoti renginiai, slapukai ir lankomumo statistika." />
    <Link href="/" style={styles.link}>← Visi renginiai</Link>
    <Text style={styles.eyebrow}>DRACULA</Text>
    <Text role="heading" aria-level={1} style={styles.heading}>Privatumas</Text>
    <P>Dracula – gyvos muzikos renginių Vilniuje sąrašas. Renkame tik tiek duomenų, kiek reikia, kad svetainė veiktų, ir jų niekam neparduodame. Klausimus apie privatumą siųskite <Email />.</P>

    <Section title="Kai naršote be paskyros">
      <P>Renginius galite peržiūrėti neprisijungę – nieko apie jus neprašome. Jei išsaugote renginį neprisijungę, jis lieka tik jūsų naršyklėje ir į mūsų serverį nesiunčiamas.</P>
      <P>Kaip ir dauguma svetainių, serveris trumpą laiką saugo techninius užklausų įrašus (pavyzdžiui, IP adresą, laiką ir atidarytą puslapį). Jie reikalingi, kad svetainė veiktų ir būtų apsaugota nuo piktnaudžiavimo.</P>
    </Section>

    <Section title="Kai prisijungiate per „Google“">
      <P>Iš „Google“ gauname ir saugome jūsų vardą, profilio nuotraukos nuorodą ir paskyros identifikatorių, pagal kurį jus atpažįstame kitą kartą. El. pašto adreso nesaugome, o jūsų „Google“ slaptažodžio ir kitų „Google“ duomenų nematome.</P>
      <P>Prisijungus jūsų išsaugoti renginiai saugomi paskyroje, kad matytumėte juos visuose įrenginiuose. Vardą galite pakeisti paskyros puslapyje.</P>
      <P>Paskyrą galite ištrinti bet kada paskyros puslapyje. Kartu ištriname jūsų vardą, nuotraukos nuorodą, išsaugotus renginius ir prisijungimo sesijas, o jūs atsijungiate visuose įrenginiuose. Atsarginėse kopijose duomenys gali išlikti ribotą laiką, kol kopijos pakeičiamos naujomis.</P>
    </Section>

    <Section title="Lankomumo statistika">
      <P>Kad žinotume, kurie renginiai ir svetainės dalys naudingi, skaičiuojame apsilankymus su „PostHog“ (duomenys saugomi Europos Sąjungoje). Matome, kurie puslapiai atidaromi, kiek laiko juose praleidžiama, kur spaudžiama ir ko ieškoma – pavyzdžiui, kad renginys buvo išsaugotas ar atidaryta bilietų nuoroda.</P>
      <P>Statistika anoniminė: jūsų naršyklėje nieko nesaugome ir slapukų tam nenaudojame. Apsilankymai atskiriami tik tos pačios dienos ribose pagal kodą, kurį „PostHog“ sukuria iš IP adreso ir naršyklės duomenų; pats IP adresas nesaugomas. Statistikos nesiejame su jūsų paskyra ir neįrašinėjame, ką darote ekrane.</P>
    </Section>

    <Section title="Slapukai">
      <P>Naudojame tik būtinus slapukus: vienas prisijungimo metu kelioms minutėms apsaugo prisijungimą, kitas iki 30 dienų atsimena, kad esate prisijungę. Stebėjimo, reklamos ar lankomumo statistikos slapukų nenaudojame.</P>
      <P>Prisijungimo mygtuką įkelia „Google“, todėl paskyros puslapyje „Google“ gali naudoti savo slapukus pagal savo privatumo politiką.</P>
    </Section>

    <Section title="Renginių informacija">
      <P>Renginių aprašymus ir nuotraukas imame iš viešų šaltinių ir prie kiekvieno renginio nurodome nuorodą į šaltinį. Jei esate organizatorius ir norite ką nors pataisyti ar pašalinti, parašykite <Email />.</P>
    </Section>

    <Section title="Jūsų teisės">
      <P>Galite paprašyti parodyti, pataisyti ar ištrinti apie jus saugomus duomenis – rašykite <Email />. Jei manote, kad jūsų duomenys tvarkomi netinkamai, galite kreiptis į Valstybinę duomenų apsaugos inspekciją (vdai.lrv.lt).</P>
    </Section>

    <Text style={styles.updated}>Atnaujinta {updated} Pasikeitus šiai informacijai, atnaujinsime šį puslapį.</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#100e15' },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 28, paddingBottom: 48, gap: 14 },
  eyebrow: { color: '#ed7d83', fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: 12 },
  heading: { color: '#fff', fontSize: 38, fontWeight: '800' },
  section: { gap: 10, paddingTop: 14 },
  subheading: { color: '#fff', fontSize: 20, fontWeight: '700' },
  text: { color: '#c9bfcb', fontSize: 16, lineHeight: 25 },
  link: { color: '#f1c6c7', fontWeight: '700' },
  updated: { color: '#8f8493', fontSize: 13, lineHeight: 20, paddingTop: 18 },
});
