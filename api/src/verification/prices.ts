import { normalizeEvidence, type Finding, type sourceEvidence } from './rules.js';
import type { Snapshot } from './history.js';

type PriceType = 'paid' | 'free';
type PriceEvidence = { type: PriceType; text?: string; evidence: string; ambiguous?: true };
type Source = ReturnType<typeof sourceEvidence>;
const admission = /(?<!\p{L})(?:biliet(?:ai|o|ų|as)|įėjim(?:as|o)|tickets?|admission|entry)(?!\p{L})/u;
const amount = '(\\d+[,.]\\d{1,2}|\\d+)';
const amountPattern = `(?:(nuo|from)\\s+)?(?:€\\s*)?${amount}(?:\\s*(?:€|eur))?(?:\\s*[-–—]\\s*(?:€\\s*)?${amount})?\\s*(?:€|eur)?`;
const pricePattern = new RegExp(`^${amountPattern}$`, 'u');
const ticketLabel = /^(?:bilietai(?: kainuoja)?|bilieto kaina|bilietų kaina|įėjimo kaina|įėjimas|kaina|tickets?(?: price| cost)?|admission|entry)(?!\p{L})\s*[:–-]?\s*/u;
const ticketAmounts = /(?:\d+[,.]\d{1,2}|\d+)\s*(?:€|eur\b)|€\s*\d+/gu;
const free = /^(?:(?:bilietai|įėjimas(?: yra)?)\s*[:–-]?\s*(?:nemokami|nemokamas)|įėjimas laisvas|renginys nemokamas|nemokamas renginys|free (?:entry|admission)|(?:entry|admission)\s*[:–-]?\s*(?:is )?free)[.!]?$/u;

export function ticketPriceValue(value: string) {
  const clean = normalizeEvidence(value);
  if (!/(?:€|\beur\b)/u.test(clean)) return;
  const match = pricePattern.exec(clean);
  if (!match) return;
  const [, from, low, high] = match;
  const minimum = Number(low.replace(',', '.'));
  const maximum = high ? Number(high.replace(',', '.')) : undefined;
  if (!Number.isFinite(minimum) || minimum <= 0 || (maximum !== undefined && (!Number.isFinite(maximum) || maximum <= minimum))) return;
  return `${from ? 'Nuo ' : ''}${String(minimum).replace('.', ',')}${maximum === undefined ? '' : `–${String(maximum).replace('.', ',')}`} €`;
}

function sourcePrices(source: Source) {
  const prices: PriceEvidence[] = [];
  if (typeof source.price_text === 'string') {
    const text = ticketPriceValue(source.price_text);
    if (text) prices.push({ type: 'paid', text, evidence: source.price_text });
  }
  if (source.price_type === 'paid' || source.price_type === 'free') prices.push({ type: source.price_type, evidence: source.price_type });
  if (source.source === 'avilys') {
    const from = typeof source.priceFrom === 'number' || typeof source.priceFrom === 'string' ? Number(source.priceFrom) : NaN;
    const to = typeof source.priceTo === 'number' || typeof source.priceTo === 'string' ? Number(source.priceTo) : NaN;
    const text = Number.isFinite(from) && from > 0 ? ticketPriceValue(`${from}${Number.isFinite(to) && to > from ? `–${to}` : ''} €`) : undefined;
    if (text) prices.push({ type: 'paid', text, evidence: `Avilys ticket price · ${text}` });
    if (typeof source.free === 'boolean') prices.push({ type: source.free ? 'free' : 'paid', evidence: `Avilys free admission · ${source.free ? 'yes' : 'no'}` });
  }
  for (const line of source.description.split(/\n+|(?<=[.!?])\s+/u)) {
    const evidence = line.trim();
    const clean = normalizeEvidence(evidence).replace(/^• /u, '');
    const label = ticketLabel.exec(clean);
    const description = label ? clean.slice(label[0].length).replace(/[.!?]$/u, '').trim() : '';
    const [beforePipe, ...notes] = description.split(/\s*\|\s*/u);
    const text = ticketPriceValue(description) ??
      (notes.length && [...notes.join(' ').matchAll(ticketAmounts)].length === 0 ? ticketPriceValue(beforePipe) : undefined);
    if (text) prices.push({ type: 'paid', text, evidence: evidence.slice(0, 500) });
    else if (label && [...description.matchAll(ticketAmounts)].length > 1) {
      prices.push({ type: 'paid', ambiguous: true, evidence: evidence.slice(0, 500) });
    }
    if (free.test(clean)) prices.push({ type: 'free', evidence });
  }
  return prices;
}

export function reconcilePrices(findings: Finding[], sources: Source[], saved: Snapshot) {
  const result = findings.filter(finding => finding.field !== 'price_type' && finding.field !== 'price_text');
  const prices = sources.flatMap(sourcePrices);
  const types = new Set(prices.map(price => price.type));
  const priceTexts = new Map<string, { text: string; evidence: string }>();
  for (const { text, evidence } of prices) {
    if (!text) continue;
    const key = text.replace(/^Nuo /u, '');
    if (text.startsWith('Nuo ') || !priceTexts.has(key)) priceTexts.set(key, { text, evidence });
  }
  const savedText = typeof saved.price_text === 'string' ? saved.price_text.trim() : '';
  const savedAmount = ticketPriceValue(savedText);
  const sourceType = prices[0]?.type;
  const savedType = saved.price_type;
  const quotedIssue = findings.find(finding => {
    const quote = normalizeEvidence(finding.evidence);
    return (finding.field === 'price_text' || finding.field === 'price_type') && finding.disposition === 'attention' &&
      admission.test(quote) && [...quote.matchAll(ticketAmounts)].length > 1;
  });

  const add = (field: 'price_text' | 'price_type', disposition: Finding['disposition'], proposed: string, evidence: string, reason: string) =>
    result.push({ field, disposition, proposed, evidence, reason });

  if (types.size > 1 || (sourceType === 'free' && savedAmount)) {
    add('price_type', 'attention', types.size === 1 ? 'free' : '', prices.slice(0, 4).map(price => price.evidence).join(' / '),
      'The ticket evidence gives conflicting admission types.');
    return result;
  }
  if (sourceType && (savedType === 'free' || savedType === 'paid') && sourceType !== savedType) {
    add('price_type', 'attention', sourceType, prices.find(price => price.text)?.evidence ?? prices[0].evidence,
      'The source admission type differs from the saved value.');
    return result;
  }
  const ambiguous = prices.find(price => price.ambiguous);
  if (ambiguous || priceTexts.size > 1) {
    const evidence = ambiguous?.evidence ?? [...priceTexts.values()].slice(0, 4).map(price => price.evidence).join(' / ');
    add('price_text', 'attention', '', evidence, 'The ticket evidence gives more than one general admission price.');
  } else if (priceTexts.size === 1) {
    const [[amount, { text, evidence }]] = priceTexts;
    if (!savedText || savedAmount?.replace(/^Nuo /u, '') === amount) {
      add('price_text', savedText ? 'confirmed' : 'suggestion', savedText || text, evidence, 'The listing explicitly gives the general ticket price.');
    } else if (savedAmount) {
      add('price_text', 'attention', text, evidence, 'The general ticket price differs from the saved value.');
    }
  } else if (quotedIssue) {
    result.push({ ...quotedIssue, proposed: '' });
  }
  const inferredType = sourceType ?? (savedAmount ? 'paid' : undefined);
  const typeEvidence = prices.find(price => price.text)?.evidence ?? prices[0]?.evidence ?? savedText;
  if (inferredType && (!savedType || savedType === 'unknown' || savedType === inferredType)) {
    // A quoted price conflict for this field takes priority over confirmation.
    if (!result.some(finding => finding.field === 'price_type')) {
      add('price_type', savedType === inferredType ? 'confirmed' : 'suggestion', inferredType, typeEvidence, 'The ticket information establishes the admission type.');
    }
  }
  return result;
}
