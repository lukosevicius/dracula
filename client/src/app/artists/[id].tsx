import { useEffect, useState } from 'react';
import { Link, Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArtistEvents } from '../../components/artist-events';
import { fetchArtist } from '../../utils/events-api';
import { displayText } from '../../utils/event-format';
import { useFollowedArtists, type FollowedArtist } from '../../utils/followed-artists';
import { artistsEnabled } from '../../constants/features';

export default function ArtistPageRoute() {
  return artistsEnabled ? <ArtistPage /> : <Redirect href="/" />;
}

function ArtistPage() {
  const {id}=useLocalSearchParams<{id:string}>();
  const [artist,setArtist]=useState<FollowedArtist|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  const follows=useFollowedArtists();
  useEffect(()=>{const controller=new AbortController();setArtist(null);setLoading(true);setError(false);fetchArtist(id||'',controller.signal).then(value=>{if(!controller.signal.aborted)setArtist(value);}).catch(()=>{if(!controller.signal.aborted)setError(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return ()=>controller.abort();},[id,retry]);
  const followed=!!artist && follows.artists.some(item=>item.mbid===artist.mbid);
  if(loading || error || !artist) return <View style={styles.page}><Stack.Screen options={{title:'Atlikėjas'}} /><Text accessibilityRole={error?'alert':undefined} style={styles.copy}>{loading?'Kraunamas atlikėjas...':error?'Nepavyko įkelti atlikėjo.':'Atlikėjo neradome.'}</Text>{error?<Pressable onPress={()=>setRetry(v=>v+1)}><Text style={styles.link}>Bandyti dar kartą</Text></Pressable>:null}<Link href="/" style={styles.link}>← Visi renginiai</Link></View>;
  return <><Stack.Screen options={{title:displayText(artist.name)}} /><ArtistEvents ids={[artist.mbid]} empty="Artėjančių šio atlikėjo renginių kol kas nėra." header={<View style={styles.header}><Link href="/" style={styles.link}>← Visi renginiai</Link><Text style={styles.eyebrow}>ATLIKĖJAS</Text><Text style={styles.title}>{displayText(artist.name)}</Text><Pressable accessibilityRole="button" accessibilityState={{disabled:follows.loading || follows.error,selected:followed}} disabled={follows.loading || follows.error} onPress={()=>follows.toggle(artist)} style={[styles.button,followed && styles.followed]}><Text style={[styles.buttonText,followed && styles.followedText]}>{followed?'Sekama ✓':'Sekti atlikėją'}</Text></Pressable>{follows.error?<View><Text accessibilityRole="alert" style={styles.error}>Nepavyko išsaugoti sekamų atlikėjų.</Text><Pressable onPress={follows.retry}><Text style={styles.link}>Bandyti dar kartą</Text></Pressable></View>:null}<Text style={styles.subtitle}>Artėjantys renginiai</Text></View>} /></>;
}
const styles=StyleSheet.create({page:{padding:24,gap:16},header:{paddingTop:32,paddingBottom:12,gap:16},eyebrow:{color:'#ed7d83',fontSize:11,fontWeight:'800',letterSpacing:2},title:{color:'#fff',fontSize:38,fontWeight:'800'},subtitle:{color:'#fff',fontSize:24,fontWeight:'800',marginTop:12},copy:{color:'#b9b0bd',fontSize:16},error:{color:'#ffaaaa'},link:{color:'#f1c6c7',fontSize:15,fontWeight:'700'},button:{alignSelf:'flex-start',backgroundColor:'#f0e8e7',borderRadius:30,paddingHorizontal:20,paddingVertical:12},buttonText:{color:'#1b121b',fontWeight:'700'},followed:{backgroundColor:'#302a33',borderWidth:1,borderColor:'#ed7d83'},followedText:{color:'#f1c6c7'}});
