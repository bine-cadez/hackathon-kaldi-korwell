import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeTextBytes, normalizeUnicode, slovenianSortKey } from '../shared/utils/text.ts'

const SAMPLE = 'Poročilo: Šola, Žiga, Čebelica — „narekovaji“ in 5 €'

test('UTF-8, with or without a BOM, is decoded as UTF-8', () => {
  const bytes = new TextEncoder().encode(SAMPLE)
  assert.deepEqual(decodeTextBytes(bytes), { text: SAMPLE, encoding: 'utf-8' })
  assert.deepEqual(decodeTextBytes(Uint8Array.of(0xef, 0xbb, 0xbf, ...bytes)), { text: SAMPLE, encoding: 'utf-8' })
})

test('Windows-1250 (Excel and Notepad on Slovenian Windows) keeps č š ž', () => {
  // Encode with the platform's legacy tables by reversing its decoder.
  const decoder = new TextDecoder('windows-1250')
  const table = new Map<string, number>()
  for (let byte = 0; byte < 256; byte++) table.set(decoder.decode(Uint8Array.of(byte)), byte)
  const bytes = Uint8Array.from([...SAMPLE].map(character => table.get(character)!))
  assert.deepEqual(decodeTextBytes(bytes), { text: SAMPLE, encoding: 'windows-1250' })
})

test('ISO-8859-2 is told apart from Windows-1250 by where Š and Ž sit', () => {
  const text = 'Šola in žaga, čas'
  const decoder = new TextDecoder('iso-8859-2')
  const table = new Map<string, number>()
  for (let byte = 0; byte < 256; byte++) table.set(decoder.decode(Uint8Array.of(byte)), byte)
  const bytes = Uint8Array.from([...text].map(character => table.get(character)!))
  assert.deepEqual(decodeTextBytes(bytes), { text, encoding: 'iso-8859-2' })
})

test('our legacy tables match the platform decoders byte for byte', () => {
  for (const [encoding, name] of [['windows-1250', 'windows-1250'], ['iso-8859-2', 'iso-8859-2']] as const) {
    const platform = new TextDecoder(name)
    for (let byte = 0xa0; byte < 256; byte++) {
      // Force our decoder down the legacy path with an invalid UTF-8 lead byte (0xff never starts UTF-8).
      const ours = decodeTextBytes(Uint8Array.of(encoding === 'windows-1250' ? 0x80 : 0xa9, byte, 0xff)).text
      assert.equal(ours[1], platform.decode(Uint8Array.of(byte)), `${encoding} 0x${byte.toString(16)}`)
    }
  }
})

test('UTF-16 with a byte order mark is decoded (Excel "Unicode text")', () => {
  const text = 'Čevapčiči'
  const le = [0xff, 0xfe]
  const be = [0xfe, 0xff]
  for (const unit of [...text].map(character => character.charCodeAt(0))) {
    le.push(unit & 0xff, unit >> 8)
    be.push(unit >> 8, unit & 0xff)
  }
  assert.deepEqual(decodeTextBytes(Uint8Array.from(le)), { text, encoding: 'utf-16le' })
  assert.deepEqual(decodeTextBytes(Uint8Array.from(be)), { text, encoding: 'utf-16be' })
})

test('decomposed letters are stored composed', () => {
  const decomposed = 'Poročilo.pdf'
  assert.notEqual(decomposed, 'Poročilo.pdf')
  assert.equal(normalizeUnicode(decomposed), 'Poročilo.pdf')
})

test('the sort key follows the Slovenian alphabet', () => {
  const words = ['zebra', 'Čas', 'cvet', 'Šola', 'sova', 'Žaba', 'ćevap', 'dan', 'Đurđa', 'éclair', 'tla']
  const sorted = [...words].sort((left, right) => (slovenianSortKey(left) < slovenianSortKey(right) ? -1 : 1))
  assert.deepEqual(sorted, ['Čas', 'cvet', 'ćevap', 'dan', 'Đurđa', 'éclair', 'sova', 'Šola', 'tla', 'zebra', 'Žaba'].sort((left, right) => left.localeCompare(right, 'sl')))
  assert.equal(slovenianSortKey('Poročilo'), slovenianSortKey('Poročilo'))
})
