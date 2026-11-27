import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, guessCity, placeForIp } from '../dist/geo/locate.js';

const listed = ['Vilnius', 'Kaunas', 'Klaipėda', 'Šiauliai', 'Panevėžys'];

test('finds the place for Lithuanian IPv4 and IPv6 addresses', () => {
  assert.equal(placeForIp('2.24.160.5'), 'Vilnius');
  assert.equal(placeForIp('37.157.149.20'), 'Kaunas');
  assert.equal(placeForIp('2001:678:6::1'), 'Kaunas');
  assert.equal(placeForIp('::ffff:37.157.149.20'), 'Kaunas');
  assert.equal(placeForIp('37.0.171.9'), 'Klaipėda');
});

test('gives null outside Lithuania and for anything that is not an address', () => {
  for (const ip of ['8.8.8.8', '2001:4860:4860::8888', '127.0.0.1', '::1', '', 'not-an-ip', '999.1.1.1']) assert.equal(placeForIp(ip), null, ip);
});

test('matches listed cities with or without Lithuanian letters, and suburbs to their city', () => {
  assert.equal(guessCity('46.249.171.10', listed), 'Panevėžys');
  assert.equal(guessCity('45.84.246.10', listed), 'Kaunas');
  assert.equal(guessCity('37.157.149.20', ['Vilnius']), null);
  assert.equal(guessCity('8.8.8.8', listed), null);
});

test('takes the visitor address from the first X-Forwarded-For entry', () => {
  assert.equal(clientIp('37.157.149.20, 10.0.0.1', '10.0.0.2'), '37.157.149.20');
  assert.equal(clientIp(['2.24.160.5'], undefined), '2.24.160.5');
  assert.equal(clientIp(undefined, '::ffff:10.0.0.2'), '::ffff:10.0.0.2');
});
