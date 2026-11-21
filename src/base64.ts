const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const values = new Int8Array(128).fill(-1);
for (let i = 0; i < alphabet.length; i++) values[alphabet.charCodeAt(i)] = i;

/**
 * Decodes standard base64, ignoring whitespace and accepting missing padding. Returns
 * undefined when the text is not base64. Written by hand so the library needs neither Buffer
 * nor atob.
 */
export function decodeBase64(text: string): Uint8Array | undefined {
  const clean = text.replace(/[ \t\r\n]+/g, "");
  const data = clean.replace(/={1,2}$/, "");
  if (
    data.length % 4 === 1 ||
    (clean.length !== data.length && clean.length % 4)
  )
    return undefined;
  const out = new Uint8Array(Math.floor((data.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    const value = code < 128 ? values[code]! : -1;
    if (value < 0) return undefined;
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}
