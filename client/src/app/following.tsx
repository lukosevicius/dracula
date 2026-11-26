import { Link, Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArtistEvents } from '../components/artist-events';
import { displayText } from '../utils/event-format';
import { useFollowedArtists } from '../utils/followed-artists';
import { artistsEnabled } from '../constants/features';

export default function FollowingPageRoute() {
  return artistsEnabled ? <FollowingPage /> : <Redirect href="/" />;
}

function FollowingPage() {
  const {artists,loading,error,retry}=useFollowedArtists();
  const header=<View style={styles.header}><Text style={styles.eyebrow}>TAVO ATLIKĖJAI</Text><Text style={styles.title}>Seku</Text><Text style={styles.copy}>Artėjančių sekamų atlikėjų renginiai vienoje vietoje.</Text>{artists.length?<View style={styles.artists}><Text style={styles.label}>SEKAMI ATLIKĖJAI</Text><View style={styles.chips}>{artists.map(artist=><Link key={artist.mbid} href={{pathname:'/artists/[id]',params:{id:artist.mbid}}} style={styles.chip}>{displayText(artist.name)} →</Link>)}</View></View>:null}</View>;
  if(loading || error) return <View style={styles.container}>{header}<Text accessibilityRole={error?'alert':undefined} style={error?styles.error:styles.copy}>{error?'Nepavyko įkelti sekamų atlikėjų.':'Kraunami sekami atlikėjai...'}</Text>{error?<Pressable accessibilityRole="button" onPress={retry}><Text style={styles.link}>Bandyti dar kartą</Text></Pressable>:null}</View>;
  return <ArtistEvents ids={artists.map(a=>a.mbid)} header={header} empty={artists.length?'Artėjančių sekamų atlikėjų renginių kol kas nėra.':'Dar neseki atlikėjų. Atidaryk atlikėjo puslapį iš renginio ir paspausk „Sekti atlikėją“.'} />;
}
const styles=StyleSheet.create({container:{width:'100%',maxWidth:1264,alignSelf:'center',paddingHorizontal:18,gap:16},header:{paddingTop:30,paddingBottom:10,gap:10},eyebrow:{color:'#ed7d83',fontSize:11,fontWeight:'800',letterSpacing:2},title:{color:'#fff',fontSize:38,fontWeight:'800'},copy:{color:'#b9b0bd',fontSize:15,lineHeight:22},label:{color:'#ed7d83',fontSize:11,fontWeight:'800',letterSpacing:1.5},artists:{gap:10,paddingTop:10},chips:{flexDirection:'row',flexWrap:'wrap',gap:8},chip:{overflow:'hidden',borderWidth:1,borderColor:'#66515d',borderRadius:24,paddingHorizontal:14,paddingVertical:9,color:'#f1c6c7'},error:{color:'#ffaaaa'},link:{color:'#f1c6c7',fontWeight:'700'}});
