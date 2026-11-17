/** Read-only Avilys search adapter. Timestamps are kept verbatim until their timezone is verified. */
export type AvilysEvent = { id:number; title:string; startTime:string|null; endTime:string|null; venueName:string|null; city:string|null; description:string|null; sourceUrl:string|null; imageUrl:string|null; ticketUrl:string|null; free:boolean|null; priceFrom:string|number|null; priceTo:string|number|null; categories:{id:number;name:string}[] };
export type AvilysPage = {data:AvilysEvent[];page:number;pageSize:number;total:number};

export async function fetchAvilysPage(page:number, request:typeof fetch=fetch):Promise<AvilysPage> {
  if (!Number.isSafeInteger(page) || page<1 || page>10000) throw new Error('Invalid Avilys page.');
  const url=new URL('https://events-api-production-1ec2.up.railway.app/api/events');
  for(const [key,value] of Object.entries({page:String(page),pageSize:'20',orderBy:'startTime',orderDirection:'ASC',hideExpired:'true',sponsoredFirst:'false',location:'Vilnius',categories:'1'})) url.searchParams.set(key,value);
  const response=await request(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`Avilys returned HTTP ${response.status}.`);
  const value:unknown=await response.json();
  if(!value || typeof value!=='object') throw new Error('Invalid Avilys response.');
  const body=value as Record<string,unknown>;
  if(!Array.isArray(body.data)||!Number.isSafeInteger(body.total)||Number(body.total)<0||body.page!==page||body.pageSize!==20||body.data.length>20) throw new Error('Invalid Avilys pagination.');
  for(const event of body.data) if(!event || typeof event!=='object'||!Number.isSafeInteger(event.id)||event.id<1||typeof event.title!=='string'||!event.title.trim()||!Array.isArray(event.categories)) throw new Error('Invalid Avilys event.');
  return body as AvilysPage;
}
