import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFor, checkedPerformers, oneMatchOutcome } from '../dist/artists/matching.js';
import { catalogueByName } from '../dist/verification/artists.js';
import { clearMatch } from '../dist/artists/musicbrainz-lookup.js';

const text = 'TITLE: Mykolas Natalevičius | Garsiniai pasivaikščiojimai\n\nGarsinis pasivaikščiojimas su kompozitoriumi Mykolu Natalevičiumi. Pastarąją gyvai atliks pianistė Gabija Natalevičiūtė – „Fortepijonas“.';
const performer = (written: string, name = written, extra = {}) => ({ written, name, role: 'main', performing: true, evidence: '', country: '', country_written: '', ...extra });

test('keeps performers whose name is in the text, even when the quote is reworded', () => {
  const found = checkedPerformers({ performers: [
    performer('Mykolu Natalevičiumi', 'Mykolas Natalevičius', { evidence: 'su kompozitoriumi Mykolas Natalevičius' }),
    performer('Gabija Natalevičiūtė', 'Gabija Natalevičiūtė', { evidence: 'pianistė Gabija Natalevičiūtė - "Fortepijonas"' }),
    performer('Coleman Hawkins'),
  ] }, text);
  assert.deepEqual(found.map(p => [p.name, p.evidence]), [
    ['Mykolas Natalevičius', ''],
    ['Gabija Natalevičiūtė', 'pianistė Gabija Natalevičiūtė - "Fortepijonas"'],
  ]);
});

test('drops repeated performers and rejects a malformed answer', () => {
  assert.equal(checkedPerformers({ performers: [performer('Mykolu Natalevičiumi', 'Mykolas Natalevičius'), performer('Mykolas Natalevičius')] }, text).length, 1);
  assert.throws(() => checkedPerformers({ performers: [{ written: 'x' }] }, text));
  assert.throws(() => checkedPerformers({}, text));
});

test('finds artists by basic name or by written name, with or without Lithuanian letters', () => {
  const index = catalogueByName([
    { mbid: 'a', name: 'Mykolas Natalevičius', disambiguation: null, aliases_json: '[]' },
    { mbid: 'b', name: 'Jurga', disambiguation: 'singer', aliases_json: '[]' },
    { mbid: 'c', name: 'Jurga', disambiguation: 'band', aliases_json: '["Jurgos grupe"]' },
  ]);
  assert.deepEqual(candidatesFor(index, { name: 'Mykolas Natalevicius', written: 'Mykolu Natalevičiumi' }).map(c => c.mbid), ['a']);
  assert.deepEqual(candidatesFor(index, { name: 'Jurga', written: 'Jurga' }).map(c => c.mbid), ['b', 'c']);
  assert.deepEqual(candidatesFor(index, { name: 'Bill Laurance', written: 'Bill Laurance' }), []);
});

test('links two-word names automatically and leaves one-word names for an editor', () => {
  assert.equal(oneMatchOutcome({ name: 'Alina Orlova', performing: true }), 'linked');
  assert.equal(oneMatchOutcome({ name: 'Saulė', performing: true }), 'suggested');
  assert.equal(oneMatchOutcome({ name: 'Alina Orlova', performing: false }), 'suggested');
});

test('keeps a country only when its words are in the text', () => {
  const text = 'VILNIUS MAMA JAZZ | Bill Laurance (UK) ir Timo Lassy Trio';
  const found = checkedPerformers({ performers: [
    { written: 'Bill Laurance', name: 'Bill Laurance', role: 'main', performing: true, evidence: '', country: 'GB', country_written: 'UK' },
    { written: 'Timo Lassy Trio', name: 'Timo Lassy Trio', role: 'main', performing: true, evidence: '', country: 'FI', country_written: 'Suomija' },
  ] }, text);
  assert.deepEqual(found.map(p => [p.name, p.country]), [['Bill Laurance', 'GB'], ['Timo Lassy Trio', '']]);
});

test('takes a MusicBrainz artist only when exactly one strong match has the name', () => {
  const bill = { id: '0a1b2c3d-1111-4222-8333-444455556666', name: 'Bill Laurance', score: 100, country: 'GB', type: 'Person', aliases: [] };
  assert.equal(clearMatch('Bill Laurance', [bill])?.country, 'GB');
  assert.equal(clearMatch('Bill Laurance', [bill, { ...bill, id: '0a1b2c3d-1111-4222-8333-444455557777' }]), null);
  assert.equal(clearMatch('Bill Laurance', [{ ...bill, score: 60 }]), null);
  assert.equal(clearMatch('Bill Laurance', [{ ...bill, name: 'Bill Laurance Trio' }]), null);
  assert.equal(clearMatch('Billas Laurance', [{ ...bill, aliases: [{ name: 'Billas Laurance' }] }])?.name, 'Bill Laurance');
});
