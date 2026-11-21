import { useEffect, useState } from 'react';
import { fetchEvents, type DisplayEvent } from './events-api';

// Each API page is filtered before pagination. Chunk IDs to keep requests bounded.
export function useArtistEvents(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',');
  const [items,setItems] = useState<DisplayEvent[]>([]);
  const [loading,setLoading] = useState(ids.length > 0);
  const [error,setError] = useState(false);
  const [retry,setRetry] = useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setItems([]); setError(false);
    if(!key) { setLoading(false); return ()=>controller.abort(); }
    setLoading(true);
    async function load() {
      const unique=new Map<number,DisplayEvent>();
      const ids=key.split(',');
      for(let i=0;i<ids.length;i+=100) {
        let offset:number|null=0;
        while(offset!==null) {
          const page=await fetchEvents('upcoming','','',offset,controller.signal,100,ids.slice(i,i+100));
          for(const event of page.items) unique.set(event.id,event);
          if(page.nextOffset!==null && page.nextOffset<=offset)throw Error('Invalid pagination');
          offset=page.nextOffset;
        }
      }
      return [...unique.values()].sort((a,b)=>(a.event_date || '').localeCompare(b.event_date || '') || (b.interest_score || 1)-(a.interest_score || 1) || (a.event_time || '').localeCompare(b.event_time || '') || a.id-b.id);
    }
    void load().then(result=>{if(!controller.signal.aborted)setItems(result);}).catch(()=>{if(!controller.signal.aborted)setError(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[key,retry]);
  return {items,loading,error,retry:()=>setRetry(value=>value+1)};
}
