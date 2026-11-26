/** Plain, comparable text: HTML and entities removed, accents and case dropped, spaces collapsed. */
export function normalizeEventSearch(value: string) {
  return value.replace(/<[^>]*>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(entity,code)=>{
    const point=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):parseInt(code,10);
    return Number.isInteger(point)&&point>=0&&point<=0x10ffff?String.fromCodePoint(point):entity;
  }).replace(/&(?:amp|quot|apos|nbsp|lt|gt);/gi,entity=>(<Record<string, string>>{'&amp;':'&','&quot;':'"','&apos;':"'",'&nbsp;':' ','&lt;':'<','&gt;':'>'})[entity.toLowerCase()]||entity)
    .normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('lt').replace(/\s+/g,' ').trim();
}

/** A title matches when the normalized search text appears anywhere in it, such as "viva italia" in „VIVA ITALIA!“. */
export function matchesEventSearch(title: string, normalizedSearch: string) {
  return normalizeEventSearch(title).includes(normalizedSearch);
}
