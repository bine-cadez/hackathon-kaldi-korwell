// Text handling shared by the upload form (browser) and the API (Worker).
//
// D1 stores UTF-8, so č, š, ž and every other character are kept as-is. What
// goes wrong in practice is before and after storage:
// - Files from Excel or Notepad on Slovenian Windows are often Windows-1250, not
//   UTF-8. Decoded as UTF-8, every č becomes "�". decodeTextBytes detects that.
// - The same letter can arrive composed (č) or decomposed (c + combining caron),
//   for example in file names from macOS. Equal-looking strings then fail to
//   match. normalizeUnicode stores everything composed (NFC).
// - SQLite compares bytes, so Č, Š, Ž sort after Z. slovenianSortKey builds a
//   key that sorts in Slovenian alphabet order: c < č < ć < d … s < š < t … z < ž.

export type DetectedEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1250' | 'iso-8859-2'

export interface DecodedText {
  text: string
  encoding: DetectedEncoding
}

// Bytes 0x80–0xFF. Built from the WHATWG Encoding Standard tables.
const WINDOWS_1250 = '€\u0081‚\u0083„…†‡\u0088‰Š‹ŚŤŽŹ\u0090‘’“”•–—\u0098™š›śťžź ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙'
// Bytes 0xA0–0xFF; 0x80–0x9F are the C1 controls (same code point as the byte).
const ISO_8859_2 = ' Ą˘Ł¤ĽŚ§¨ŠŞŤŹ­ŽŻ°ą˛ł´ľśˇ¸šşťź˝žżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙'

function decodeSingleByte (bytes: Uint8Array, encoding: 'windows-1250' | 'iso-8859-2'): string {
  let text = ''
  for (const byte of bytes) {
    if (byte < 0x80) text += String.fromCharCode(byte)
    else if (encoding === 'windows-1250') text += WINDOWS_1250[byte - 0x80]
    else text += byte < 0xa0 ? String.fromCharCode(byte) : ISO_8859_2[byte - 0xa0]
  }
  return text
}

// ISO-8859-2 puts Š š Ž ž at 0xA9 0xB9 0xAE 0xBE, where Windows-1250 has © ą ® ľ,
// and never uses 0x80–0x9F, where Windows-1250 has Š š Ž ž and the curly quotes.
function guessLegacyEncoding (bytes: Uint8Array): 'windows-1250' | 'iso-8859-2' {
  let latin2Letters = 0
  for (const byte of bytes) {
    if (byte >= 0x80 && byte <= 0x9f) return 'windows-1250'
    if (byte === 0xa9 || byte === 0xb9 || byte === 0xae || byte === 0xbe) latin2Letters++
  }
  return latin2Letters > 0 ? 'iso-8859-2' : 'windows-1250'
}

// A byte order mark wins. Otherwise valid UTF-8 is UTF-8 (text with č or š in a
// legacy encoding is practically never valid UTF-8), and anything else is the
// Central European legacy encoding it most likely is.
export function decodeTextBytes (bytes: Uint8Array): DecodedText {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // Swap to little-endian so only the universally supported decoder is needed.
    const swapped = new Uint8Array(bytes.length - 2 - (bytes.length % 2))
    for (let index = 0; index < swapped.length; index += 2) {
      swapped[index] = bytes[index + 3]!
      swapped[index + 1] = bytes[index + 2]!
    }
    return { text: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf-16be' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    const encoding = guessLegacyEncoding(bytes)
    return { text: decodeSingleByte(bytes, encoding), encoding }
  }
}

export function normalizeUnicode (value: string): string {
  return value.normalize('NFC')
}

// Slovenian letters (and ć, đ from names of Croatian or Serbian origin) get a
// marker after their base letter. "{" and "|" sort after every ASCII letter
// and digit, so "cz…" < "č…" < "d…". Other accents fold onto the base letter.
// migrations/0005_document_uploads.sql backfills existing rows with the same rules.
const SORT_LETTERS: Record<string, string> = { č: 'c{', ć: 'c|', đ: 'd{', š: 's{', ž: 'z{' }

export function slovenianSortKey (value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[čćđšž]/g, letter => SORT_LETTERS[letter]!)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
}
