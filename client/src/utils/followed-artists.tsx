import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/auth-context';
import { apiUrl } from './events-api';
import { readFollowed, writeFollowed } from './followed-storage';

export type FollowedArtist = { mbid: string; name: string };
type FollowContext = { artists: FollowedArtist[]; toggle: (artist: FollowedArtist) => void; loading: boolean; error: boolean; retry: () => void };
const Context = createContext<FollowContext>({artists:[],toggle:()=>{},loading:true,error:false,retry:()=>{}});
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiUrl}/v1/me/followed-artists${path}`, {...init, credentials:'include',cache:'no-store'});
  if (!response.ok) throw new Error(`Follow request failed (${response.status})`);
  return response.json();
}
function guestArtists(): FollowedArtist[] {
  const artists: unknown = JSON.parse(readFollowed());
  if (!Array.isArray(artists) || !artists.every(a => a && typeof a.mbid === 'string' && typeof a.name === 'string')) throw Error('Invalid followed artists');
  return artists;
}
export function FollowedArtistsProvider({children}:{children:ReactNode}) {
  const {state,user} = useAuth();
  const [artists,setArtists] = useState<FollowedArtist[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const generation=useRef(0), busy=useRef(false);
  useEffect(() => {
    const current=++generation.current;
    busy.current=true; setLoading(true); setError(false); setArtists([]);
    if(state==='loading') return;
    async function load() {
      try {
        const guest=guestArtists();
        if(state==='signed-in' && user) {
          for(let i=0;i<guest.length;i+=100) {
            await request('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:guest.slice(i,i+100).map(a=>a.mbid)})});
            if(current!==generation.current)return;
          }
          const result=await request<{artists:FollowedArtist[]}>('');
          if(current!==generation.current)return;
          if(!Array.isArray(result.artists)) throw Error('Invalid artists response');
          if(guest.length) { const merged=new Set(guest.map(a=>a.mbid)); writeFollowed(JSON.stringify(guestArtists().filter(a=>!merged.has(a.mbid)))); }
          setArtists(result.artists);
        } else if(current===generation.current) setArtists(guest);
      } catch { if(current===generation.current)setError(true); }
      finally { if(current===generation.current){busy.current=false;setLoading(false);} }
    }
    void load(); return ()=>{generation.current++;};
  },[state,user?.id,refresh]);
  useEffect(()=>{
    if(typeof window==='undefined' || state==='signed-in' || state==='loading')return;
    const reload=()=>{try{setArtists(guestArtists());setError(false);}catch{setError(true);}};
    window.addEventListener('storage',reload);return ()=>window.removeEventListener('storage',reload);
  },[state]);
  const toggle=useCallback((artist:FollowedArtist)=>{
    if(busy.current || state==='loading' || error)return;
    const current=generation.current, followed=artists.some(a=>a.mbid===artist.mbid);
    const next=followed?artists.filter(a=>a.mbid!==artist.mbid):[artist,...artists];
    if(state!=='signed-in') {try{writeFollowed(JSON.stringify(next));setArtists(next);}catch{setError(true);}return;}
    busy.current=true;setLoading(true);
    const action=followed?request(`/${artist.mbid}`,{method:'DELETE'}):request('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[artist.mbid]})});
    void action.then(()=>{if(current===generation.current)setArtists(next);}).catch(()=>{if(current===generation.current)setError(true);}).finally(()=>{if(current===generation.current){busy.current=false;setLoading(false);}});
  },[artists,state,error]);
  return <Context value={{artists,toggle,loading,error,retry:()=>setRefresh(value=>value+1)}}>{children}</Context>;
}
export function useFollowedArtists(){return use(Context);}
