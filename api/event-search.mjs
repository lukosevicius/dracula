// Kept in sync with Seeker's visible-title prefix matching.
export function normalizeEventSearch(value) {
  return value.replace(/<[^>]*>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(entity,code)=>{
    const point=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):parseInt(code,10);
    return Number.isInteger(point)&&point>=0&&point<=0x10ffff?String.fromCodePoint(point):entity;
  }).replace(/&(?:amp|quot|apos|nbsp|lt|gt);/gi,entity=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&nbsp;':' ','&lt;':'<','&gt;':'>'})[entity.toLowerCase()]||entity)
    .normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('lt').replace(/\s+/g,' ').trim();
}
