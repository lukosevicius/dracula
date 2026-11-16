import { extractDetails } from './event-details.js';
import type { SourceEvent } from '../types.js';
import type { VilniusImportPage } from '../central-api.js';

type Page = {data:SourceEvent[];pages:number | null};
type Progress = {fetched:number;added:number;updated:number};
type Options = {pages:number;currentOffset:number;restart?:boolean;sample?:boolean;refresh?:boolean};

/** Runs the page orchestration locally; the API commits each page to the central database. */
export async function runCentralVilniusImport(
  options:Options,
  fetchPage:(page:number,size:number)=>Promise<Page>,
  savePage:(page:VilniusImportPage)=>Promise<{added:number;updated:number}>,
  progress:(value:Progress)=>void=()=>{}
):Promise<Progress> {
  const {pages,currentOffset,restart=false,sample=false,refresh=false}=options;
  if(!Number.isInteger(pages)||pages<1||pages>10||!Number.isSafeInteger(currentOffset)||currentOffset<0) throw new Error('Invalid import options.');
  const start=restart||sample||refresh?1:currentOffset+1;
  const overlap=sample||refresh||restart?[]:[...new Set([1,Math.max(1,start-1)])].filter(page=>page<start);
  let cursor=currentOffset,fetched=0,added=0,updated=0;
  for(let i=0;i<pages+overlap.length;i++) {
    const isOverlap=i<overlap.length,page=isOverlap?overlap[i]:start+i-overlap.length;
    const response=await fetchPage(page,sample?10:50);
    if(!Array.isArray(response.data)||(response.pages!==null&&(!Number.isSafeInteger(response.pages)||response.pages<0))) throw new Error('Unexpected source response.');
    const items=response.data.map(item=>{
      if(!Number.isSafeInteger(item.id)||item.id<1||!item.title?.rendered||!item.link) throw new Error('An event record is missing required fields.');
      const content=item.content?.rendered||'';
      return {source_id:item.id,title:item.title.rendered,source_url:item.link,content_html:content,categories:item.categories||[],featured_media:item.featured_media||null,published_at:item.date||null,modified_at:item.modified||null,details:extractDetails(content)};
    });
    const next=!items.length||(response.pages!==null&&page>=response.pages)?0:page;
    const advance=!sample&&!refresh&&!isOverlap;
    const result=await savePage({items,advance_cursor:advance,expected_offset:cursor,next_offset:next,total_available:response.pages});
    if(advance)cursor=next;
    fetched+=items.length;added+=result.added;updated+=result.updated;progress({fetched,added,updated});
    if(sample||refresh||(!isOverlap&&next===0))break;
  }
  return {fetched,added,updated};
}
