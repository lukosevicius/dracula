import { Link } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { ReactElement } from 'react';
import { EventCard } from './event-card';
import { useArtistEvents } from '../utils/use-artist-events';

export function ArtistEvents({ids,header,empty}: {ids:string[];header:ReactElement;empty:string}) {
  const {items,loading,error,retry}=useArtistEvents(ids);
  const {width}=useWindowDimensions();
  const columns=width>=1400?4:width>=1100?3:width>=700?2:1, padding=columns>1?32:18;
  const cardWidth=columns>1?(Math.min(width,1264)-padding*2-(columns-1)*20)/columns:undefined;
  return <FlatList key={columns} numColumns={columns} data={items} keyExtractor={item=>String(item.id)} renderItem={({item})=><EventCard event={item} width={cardWidth} />} columnWrapperStyle={columns>1?{gap:20}:undefined} contentContainerStyle={[styles.content,{paddingHorizontal:padding}]} ListHeaderComponent={header} ListEmptyComponent={loading?<Text style={styles.copy}>Kraunami renginiai...</Text>:error?<View style={styles.empty}><Text accessibilityRole="alert" style={styles.error}>Nepavyko įkelti renginių.</Text><Pressable accessibilityRole="button" onPress={retry}><Text style={styles.link}>Bandyti dar kartą</Text></Pressable></View>:<View style={styles.empty}><Text style={styles.copy}>{empty}</Text><Link href="/" style={styles.link}>Atrasti renginius →</Link></View>} />;
}
const styles=StyleSheet.create({content:{width:'100%',maxWidth:1264,alignSelf:'center',paddingHorizontal:18,paddingBottom:32,gap:18},copy:{color:'#b9b0bd',fontSize:15,lineHeight:22},empty:{paddingVertical:32,alignItems:'center',gap:12},error:{color:'#ffaaaa'},link:{color:'#f1c6c7',fontWeight:'700'}});
