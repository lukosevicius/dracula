import {createHash,timingSafeEqual} from 'node:crypto';
import type {Pool, RowDataPacket} from 'mysql2/promise';
interface Artist { id: string; name: string; country: string; aliases: string[]; sort_name?: string; artist_type?: string; area?: string; begin_area?: string; begin_date?: string; end_date?: string; disambiguation?: string }
interface ArtistInput { artists: Artist[]; expected_offset: number; next_offset: number; total_available: number | null; job?: { id: number; owner: string } }
interface State extends RowDataPacket { last_request_at: string | null; next_offset: number }
interface Lease extends RowDataPacket { job_id: number; owner_hash: string; expires_at: number | string }
const source='musicbrainz-lithuania-artists';
const fail=(status: number,message: string)=>Object.assign(new Error(message),{status});

export async function reserveMusicBrainz(pool: Pool){
  const conn=await pool.getConnection();try{await conn.beginTransaction();try{const [rows]=await conn.execute<State[]>('SELECT last_request_at FROM source_state WHERE source_key=? FOR UPDATE',[source]);if(rows.length!==1)throw fail(409,'Source state is missing.');const now=Date.now(),last=Date.parse(rows[0].last_request_at||'')||0,waitMs=Math.max(0,last+2000-now);if(!waitMs)await conn.execute('UPDATE source_state SET last_request_at=? WHERE source_key=?',[new Date(now).toISOString(),source]);await conn.commit();return {waitMs};}catch(error){await conn.rollback();throw error;}}finally{conn.release();}
}

export async function importMusicBrainzPage(pool: Pool, data: unknown){
  const input=data as ArtistInput;
  if(!input||!Array.isArray(input.artists)||input.artists.length>100||!Number.isSafeInteger(input.expected_offset)||input.expected_offset<0||!Number.isSafeInteger(input.next_offset)||input.next_offset<0||(input.total_available!==null&&(!Number.isSafeInteger(input.total_available)||input.total_available<0)))throw fail(400,'Invalid artist page.');
  const seen=new Set<string>();
  for(const artist of input.artists){if(!artist||typeof artist.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(artist.id)||seen.has(artist.id)||typeof artist.name!=='string'||!artist.name.trim()||artist.name.length>1000||artist.country!=='LT')throw fail(400,'Invalid artist.');seen.add(artist.id);for(const key of (['sort_name','artist_type','area','begin_area','begin_date','end_date','disambiguation'] as const))if(artist[key]!=null&&(typeof artist[key]!=='string'||artist[key].length>1000))throw fail(400,'Invalid artist metadata.');if(!Array.isArray(artist.aliases)||artist.aliases.length>1000||!artist.aliases.every(a=>typeof a==='string'&&a.length<=1000))throw fail(400,'Invalid aliases.');}
  const conn=await pool.getConnection();try{await conn.beginTransaction();try{
    const [state]=await conn.execute<State[]>('SELECT next_offset FROM source_state WHERE source_key=? FOR UPDATE',[source]);if(state.length!==1||Number(state[0].next_offset)!==input.expected_offset)throw fail(409,'Source cursor changed.');
    const [leases]=await conn.execute<Lease[]>('SELECT job_id,owner_hash,expires_at FROM job_leases WHERE source_key=? FOR UPDATE',[source]);const lease=leases[0],owner=input.job?.owner;
    if(!lease||input.job?.id!==Number(lease.job_id)||typeof owner!=='string'||!/^[a-f0-9]{64}$/.test(owner)||Number(lease.expires_at)<=Date.now()||!timingSafeEqual(Buffer.from(lease.owner_hash),Buffer.from(createHash('sha256').update(owner).digest('hex'))))throw fail(409,'The import lease is invalid or has expired.');
    let added=0,updated=0;const now=new Date().toISOString();
    for(const artist of input.artists){const [rows]=await conn.execute<RowDataPacket[]>('SELECT mbid FROM artists WHERE mbid=? FOR UPDATE',[artist.id]);if(rows.length)updated++;else added++;
      await conn.execute('INSERT INTO artists(mbid,name,sort_name,artist_type,country,area,begin_area,begin_date,end_date,disambiguation,aliases_json,source_url,first_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),sort_name=VALUES(sort_name),artist_type=VALUES(artist_type),country=VALUES(country),area=VALUES(area),begin_area=VALUES(begin_area),begin_date=VALUES(begin_date),end_date=VALUES(end_date),disambiguation=VALUES(disambiguation),aliases_json=VALUES(aliases_json),updated_at=VALUES(updated_at)',[artist.id,artist.name,artist.sort_name||null,artist.artist_type||null,'LT',artist.area||null,artist.begin_area||null,artist.begin_date||null,artist.end_date||null,artist.disambiguation||null,JSON.stringify(artist.aliases),`https://musicbrainz.org/artist/${artist.id}`,now,now]);}
    await conn.execute('UPDATE source_state SET next_offset=?,total_available=?,updated_at=? WHERE source_key=?',[input.next_offset,input.total_available,now,source]);await conn.commit();return {added,updated};
  }catch(error){await conn.rollback();throw error;}}finally{conn.release();}
}
