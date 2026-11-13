import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeTextBytes } from '../shared/utils/text.ts'

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
