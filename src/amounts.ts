/** Quantities are fixed-point integers with 8 decimals, the FatturaPA maximum. */
const quantityScale = 100_000_000n;

/** Divides and rounds half away from zero, as SDI expects for prices and VAT. */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) return -divideRounded(-numerator, denominator);
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Parses a decimal quantity into 8-decimal fixed point, or returns undefined when invalid. */
export function parseQuantity(value: number | string): bigint | undefined {
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = /^(\d{1,12})(?:\.(\d{1,8}))?$/.exec(text);
  if (!match) return;
  const scaled =
    BigInt(match[1]!) * quantityScale + BigInt((match[2] ?? "").padEnd(8, "0"));
  return scaled > 0n ? scaled : undefined;
}

/** Formats a fixed-point quantity with 2 to 8 decimals, e.g. 3 → "3.00", 1.25 → "1.25". */
export function formatQuantity(scaled: bigint): string {
  const whole = scaled / quantityScale;
  const decimals = String(scaled % quantityScale)
    .padStart(8, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${whole}.${decimals}`;
}

/** A validated price adjustment: +1 for a surcharge, -1 for a discount. */
export interface Adjustment {
  sign: 1 | -1;
  basisPoints?: number;
  amountCents?: number;
}

/**
 * Line total in cents: the unit price after its adjustments in cascade, times the quantity.
 * Computed exactly and rounded once, so it stays within SDI's one-cent tolerance.
 */
export function lineTotal(
  unitPriceCents: number,
  quantity?: bigint,
  adjustments: Adjustment[] = [],
): number {
  let numerator = BigInt(unitPriceCents);
  let denominator = 1n;
  for (const { sign, basisPoints, amountCents } of adjustments) {
    if (basisPoints !== undefined) {
      numerator *= 10_000n + BigInt(sign * basisPoints);
      denominator *= 10_000n;
    } else numerator += BigInt(sign * amountCents!) * denominator;
  }
  return Number(
    divideRounded(
      numerator * (quantity ?? quantityScale),
      denominator * quantityScale,
    ),
  );
}

/** Converts a percentage with at most 2 decimals into hundredths of a percent. */
export function rateBasisPoints(rate: number, max = 100): number | undefined {
  const bp = Math.round(rate * 100);
  return Number.isFinite(rate) &&
    rate >= 0 &&
    rate <= max &&
    Math.abs(rate * 100 - bp) < 1e-6
    ? bp
    : undefined;
}

/** VAT on a taxable amount, rounded to the cent. */
export function vatAmount(taxableCents: number, basisPoints: number): number {
  return Number(
    divideRounded(BigInt(taxableCents) * BigInt(basisPoints), 10_000n),
  );
}

/** Formats integer cents (or basis points) as a decimal with two places, e.g. 1234 → "12.34". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Splits `totalCents` across `weights` proportionally with the largest-remainder method,
 * so the parts always add up exactly to the total.
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (!weights.length) return [];
  if (sum <= 0) {
    const parts = weights.map(() => 0);
    parts[0] = totalCents;
    return parts;
  }
  const exact = weights.map((w) => (totalCents * w) / sum);
  const parts = exact.map(Math.floor);
  let left = totalCents - parts.reduce((n, p) => n + p, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index]! += 1;
    left -= 1;
  }
  return parts;
}
