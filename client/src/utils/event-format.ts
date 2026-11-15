export function displayDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Data nežinoma';
}

export function displayText(value: string) {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (entity, code: string) => {
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
  });
}

export function eventSource(aboutUrl: string | null, sourceUrl: string) {
  for (const candidate of [aboutUrl, sourceUrl]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' || url.protocol === 'http:') return { url: url.href, label: url.hostname.replace(/^www\./, '') };
    } catch { /* Try the fallback. */ }
  }
  return null;
}
