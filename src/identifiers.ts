/** Italian Partita IVA: 11 digits with a Luhn-style check digit. */
export function isValidVatNumber(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^0+$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let digit = Number(value[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10 === Number(value[10]);
}

const oddValues: Record<string, number> = Object.fromEntries(
  [1, 0, 5, 7, 9, 13, 15, 17, 19, 21].flatMap((v, i) => [
    [String(i), v],
    [String.fromCharCode(65 + i), v],
  ]),
);
Object.assign(oddValues, {
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23,
});

/**
 * Italian codice fiscale: a company's 11-digit number or a person's 16-character code,
 * including omocodia substitutions, with its check character.
 */
export function isValidFiscalCode(value: string): boolean {
  if (/^\d{11}$/.test(value)) return isValidVatNumber(value);
  const digit = "[0-9LMNPQRSTUV]";
  if (
    !new RegExp(
      `^[A-Z]{6}${digit}{2}[ABCDEHLMPRST]${digit}{2}[A-Z]${digit}{3}[A-Z]$`,
    ).test(value)
  )
    return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = value[i]!;
    sum +=
      i % 2 === 0
        ? oddValues[c]!
        : /\d/.test(c)
          ? Number(c)
          : c.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === value[15];
}

/** IBAN with a valid ISO 13616 mod-97 checksum; Italian IBANs must have 27 characters. */
export function isValidIban(value: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  if (value.startsWith("IT") && value.length !== 27) return false;
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const c of rearranged) {
    const n = /\d/.test(c) ? c : String(c.charCodeAt(0) - 55);
    for (const d of n) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** SDI recipient code (codice destinatario): 7 upper-case letters or digits for private recipients. */
export function isValidRecipientCode(value: string): boolean {
  return /^[A-Z0-9]{7}$/.test(value);
}

/** Removes spaces and upper-cases an identifier typed by a person, e.g. an IBAN. */
export function compactIdentifier(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}
