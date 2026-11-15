/** Match visible title text with the same case- and accent-insensitive prefix search used for artists. */
export function normalizeEventSearch(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (entity, code: string) => {
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  }).replace(/&(?:amp|quot|apos|nbsp|lt|gt);/gi, entity => ({'&amp;':'&','&quot;':'"','&apos;':"'",'&nbsp;':' ','&lt;':'<','&gt;':'>'})[entity.toLowerCase()] || entity)
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('lt').replace(/\s+/g, ' ').trim();
}
