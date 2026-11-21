import {
  type Adjustment,
  allocateCents,
  divideRounded,
  formatCents,
  formatQuantity,
  lineTotal,
  parseQuantity,
  percentOf,
  rateBasisPoints,
  vatAmount,
} from "./amounts.js";
import {
  isValidFiscalCode,
  isValidIban,
  isValidRecipientCode,
  isValidVatNumber,
} from "./identifiers.js";
import type {
  Address,
  DocumentReference,
  FiscalRepresentative,
  Invoice,
  InvoiceInput,
  InvoiceLine,
  InvoiceTotals,
  Nature,
  TaxRegime,
  VatSummary,
} from "./types.js";
import {
  natures,
  paymentMethods,
  paymentReasons,
  pensionFundTypes,
  taxRegimes,
  withholdingTypes,
} from "./types.js";
import { cleanText, renderXml, type XmlNode } from "./xml.js";

export interface ValidationIssue {
  /** Path of the offending input field, e.g. "lines[2].vatRate". */
  path: string;
  message: string;
}

export class FatturaPAError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(
      `Invalid invoice: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
    this.name = "FatturaPAError";
  }
}

/** Natures whose VAT-free amounts make the €2 stamp duty due above €77.47. */
const stampDutyNatures: Nature[] = ["N1", "N2.1", "N2.2", "N3.5", "N3.6", "N4"];
const stampDutyThresholdCents = 7747;
const stampDutyCents = 200;
const namespaces = [
  'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
  'xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"',
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
].join(" ");

class Checker {
  readonly issues: ValidationIssue[] = [];
  add(path: string, message: string) {
    this.issues.push({ path, message });
  }
  /** Cleans free text and checks its length and character set. */
  text(
    path: string,
    value: string | undefined,
    max: number,
    ascii = false,
  ): string {
    const { text, invalid } = cleanText(value ?? "", ascii);
    if (!text) this.add(path, "is required");
    else if (invalid)
      this.add(
        path,
        `contains "${invalid}", which SDI does not accept${ascii ? " (ASCII only)" : ""}`,
      );
    else if (text.length > max) this.add(path, `exceeds ${max} characters`);
    return text;
  }
  optionalText(
    path: string,
    value: string | undefined,
    max: number,
    ascii = false,
  ): string | undefined {
    return value === undefined || !value.trim()
      ? undefined
      : this.text(path, value, max, ascii);
  }
  date(path: string, value: string | undefined) {
    if (value === undefined) return;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      this.add(path, "must be a valid YYYY-MM-DD date");
  }
}

function country(address: { country?: string }) {
  return address.country ?? "IT";
}

/** TipoCessionePrestazione code of each line kind. */
export const lineKindCodes = {
  discount: "SC",
  premium: "PR",
  rebate: "AB",
  charge: "AC",
} as const;

/** The largest percentage the Percentuale field holds. */
const maxPercent = 999.99;

/** Normalises line adjustments for the arithmetic; invalid ones are reported by buildInvoice. */
function adjustments(line: InvoiceLine): Adjustment[] {
  return (line.adjustments ?? []).map((a) => ({
    sign: a.kind === "surcharge" ? 1 : -1,
    ...(a.percent !== undefined
      ? { basisPoints: rateBasisPoints(a.percent, maxPercent) ?? 0 }
      : { amountCents: a.amountCents ?? 0 }),
  }));
}

function checkAddress(check: Checker, path: string, address: Address) {
  const italian = country(address) === "IT";
  const city = check.text(`${path}.city`, address.city, 60);
  const result = {
    street: check.text(`${path}.street`, address.street, 60),
    streetNumber: check.optionalText(
      `${path}.streetNumber`,
      address.streetNumber,
      8,
      true,
    ),
    city,
    // A foreign postal code does not fit the 5-digit CAP: it is kept with the city instead.
    postalCode: italian ? address.postalCode : "00000",
    province: address.province,
    country: country(address),
  };
  if (italian) {
    if (!/^\d{5}$/.test(address.postalCode ?? ""))
      check.add(`${path}.postalCode`, "must be 5 digits");
  } else if (address.postalCode?.trim()) {
    const postalCode = check.text(
      `${path}.postalCode`,
      address.postalCode,
      12,
      true,
    );
    result.city = `${postalCode} ${city}`;
    if (city && result.city.length > 60)
      check.add(`${path}.city`, "exceeds 60 characters with the postal code");
  }
  if (address.province !== undefined) {
    if (!italian)
      check.add(`${path}.province`, "is only used for Italian addresses");
    else if (!/^[A-Z]{2}$/.test(address.province))
      check.add(`${path}.province`, "must be 2 upper-case letters");
  }
  if (!/^[A-Z]{2}$/.test(result.country))
    check.add(`${path}.country`, "must be an ISO 3166-1 alpha-2 code");
  return result;
}

/**
 * Checks one or several document references (DatiDocumentiCorrelatiType). A single object is
 * reported at `path`, an array at `path[i]`.
 */
function checkReferences(
  check: Checker,
  path: string,
  value: DocumentReference | DocumentReference[] | undefined,
  lineCount: number,
) {
  if (value === undefined) return [];
  const many = Array.isArray(value);
  return (many ? value : [value]).map((ref, index) => {
    const at = many ? `${path}[${index}]` : path;
    const id = check.text(`${at}.id`, ref.id, 20, true);
    check.date(`${at}.date`, ref.date);
    (ref.lineNumbers ?? []).forEach((n, i) => {
      if (!Number.isInteger(n) || n < 1 || n > lineCount)
        check.add(
          `${at}.lineNumbers[${i}]`,
          `must be a line number from 1 to ${lineCount}`,
        );
    });
    return {
      lineNumbers: ref.lineNumbers ?? [],
      id,
      date: ref.date,
      itemCode: check.optionalText(`${at}.itemCode`, ref.itemCode, 100),
      cup: check.optionalText(`${at}.cup`, ref.cup, 15, true),
      cig: check.optionalText(`${at}.cig`, ref.cig, 15, true),
    };
  });
}

/** Renders checked references as DatiDocumentiCorrelatiType elements, in schema order. */
function referenceNodes(
  name: string,
  references: ReturnType<typeof checkReferences>,
): XmlNode[] {
  return references.map((ref) => [
    name,
    [
      ...ref.lineNumbers.map((n): XmlNode => [
        "RiferimentoNumeroLinea",
        String(n),
      ]),
      ["IdDocumento", ref.id],
      ["Data", ref.date],
      ["CodiceCommessaConvenzione", ref.itemCode],
      ["CodiceCUP", ref.cup],
      ["CodiceCIG", ref.cig],
    ],
  ]);
}

/** Validates a permanent establishment: only for parties based abroad, and Italian. */
function checkEstablishment(
  check: Checker,
  party: "seller" | "buyer",
  value: { permanentEstablishment?: Address },
  abroad: boolean,
) {
  const address = value.permanentEstablishment;
  if (address === undefined) return undefined;
  const path = `${party}.permanentEstablishment`;
  if (!abroad) check.add(path, `is only for ${party}s based abroad`);
  if (country(address) !== "IT")
    check.add(`${path}.country`, "must be IT: it is the Italian establishment");
  return checkAddress(check, path, address);
}

/** Validates a fiscal representative: only for parties based abroad, and not with a PE. */
function checkRepresentative(
  check: Checker,
  party: "seller" | "buyer",
  value: {
    permanentEstablishment?: Address;
    fiscalRepresentative?: FiscalRepresentative;
  },
  abroad: boolean,
) {
  const rep = value.fiscalRepresentative;
  if (rep === undefined) return undefined;
  const path = `${party}.fiscalRepresentative`;
  if (!abroad) check.add(path, `is only for ${party}s based abroad`);
  else if (value.permanentEstablishment !== undefined)
    check.add(
      path,
      "cannot be combined with permanentEstablishment: use one or the other",
    );
  const vatCountry = rep.vatCountry ?? "IT";
  let vatNumber = rep.vatNumber;
  if (!/^[A-Z]{2}$/.test(vatCountry))
    check.add(`${path}.vatCountry`, "must be an ISO 3166-1 alpha-2 code");
  else if (vatCountry === "IT") {
    if (!isValidVatNumber(rep.vatNumber))
      check.add(`${path}.vatNumber`, "is not a valid Partita IVA");
  } else {
    vatNumber = foreignVatNumber(rep.vatNumber, vatCountry);
    if (!/^[A-Z0-9]{1,28}$/.test(vatNumber))
      check.add(`${path}.vatNumber`, "must be 1-28 letters or digits");
  }
  if (rep.fiscalCode !== undefined && !isValidFiscalCode(rep.fiscalCode))
    check.add(`${path}.fiscalCode`, "is not a valid codice fiscale");
  const name = check.text(`${path}.name`, rep.name, 80);
  return { vatNumber, vatCountry, fiscalCode: rep.fiscalCode, name };
}

/** Strips spaces and a leading country prefix from a foreign VAT number (EL for Greece). */
function foreignVatNumber(value: string, idCountry: string): string {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const prefixes = idCountry === "GR" ? ["GR", "EL"] : [idCountry];
  const prefix = prefixes.find(
    (p) => compact.startsWith(p) && compact.length > p.length,
  );
  return prefix ? compact.slice(prefix.length) : compact;
}

/** Formats basis points as a short percentage: 1000 → "10", 250 → "2.5". */
function formatPercent(basisPoints: number): string {
  return formatCents(basisPoints)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

/** The invoice fields the totals depend on. */
type TotalsInput = Pick<
  InvoiceInput,
  | "lines"
  | "stampDuty"
  | "adjustments"
  | "pensionFunds"
  | "withholdings"
  | "vatExigibility"
>;

function groupKey(vatRate: number, nature: Nature | undefined): string {
  return `${vatRate}|${nature ?? ""}`;
}

function byRate(a: VatSummary, b: VatSummary): number {
  return (
    b.vatRate - a.vatRate || (a.nature ?? "").localeCompare(b.nature ?? "")
  );
}

/**
 * Computes the totals and collects the document adjustments that have no positive taxable
 * amount to apply to (reported by buildInvoice with their input path).
 */
function totalsWithIssues(input: TotalsInput): {
  totals: InvoiceTotals;
  unappliable: number[];
} {
  const groups = new Map<string, VatSummary>();
  const group = (vatRate: number, nature: Nature | undefined) => {
    const key = groupKey(vatRate, nature);
    const found = groups.get(key) ?? {
      vatRate,
      ...(nature && { nature }),
      taxableCents: 0,
      vatCents: 0,
    };
    groups.set(key, found);
    return found;
  };
  // Whether every line of a VAT group is subject to withholding.
  const withheldGroups = new Map<string, boolean>();
  const lines = input.lines.map((line) => {
    const quantity =
      line.quantity === undefined ? undefined : parseQuantity(line.quantity);
    const lineTotalCents = lineTotal(
      line.unitPriceCents,
      quantity,
      adjustments(line),
    );
    const key = groupKey(line.vatRate, line.nature);
    withheldGroups.set(
      key,
      (withheldGroups.get(key) ?? true) && line.withholding === true,
    );
    const lineGroup = group(line.vatRate, line.nature);
    lineGroup.legalReference ??= line.legalReference;
    lineGroup.taxableCents += lineTotalCents;
    return { lineTotalCents };
  });
  const sorted = [...groups.values()].sort(byRate);
  // Document adjustments are spread over the groups in proportion to their taxable amount from
  // the lines alone; each one is computed on the running taxable amount (cascade).
  const weights = sorted.map((g) => Math.max(g.taxableCents, 0));
  const adjustmentLines: InvoiceTotals["adjustmentLines"] = [];
  const unappliable: number[] = [];
  let running = BigInt(lines.reduce((n, l) => n + l.lineTotalCents, 0));
  (input.adjustments ?? []).forEach((adjustment, adjustmentIndex) => {
    if (!weights.some((w) => w > 0)) {
      unappliable.push(adjustmentIndex);
      return;
    }
    const sign = adjustment.kind === "surcharge" ? 1 : -1;
    const absolute =
      adjustment.percent !== undefined
        ? Math.abs(
            Number(
              divideRounded(
                running *
                  BigInt(rateBasisPoints(adjustment.percent, maxPercent) ?? 0),
                10_000n,
              ),
            ),
          )
        : (adjustment.amountCents ?? 0);
    allocateCents(absolute, weights).forEach((part, i) => {
      if (!part) return;
      const target = sorted[i]!;
      target.taxableCents += sign * part;
      running += BigInt(sign * part);
      adjustmentLines.push({
        adjustmentIndex,
        vatRate: target.vatRate,
        ...(target.nature && { nature: target.nature }),
        amountCents: sign * part,
        ...(withheldGroups.get(groupKey(target.vatRate, target.nature)) && {
          withholding: true as const,
        }),
      });
    });
  });
  // Pension fund contributions are computed on the taxable amount of the lines and document
  // adjustments, then added to the VAT group of the contribution.
  const pensionBase = Number(running);
  const pensionFunds = (input.pensionFunds ?? []).map((fund) => {
    const taxableCents = fund.taxableCents ?? pensionBase;
    const contributionCents = percentOf(
      taxableCents,
      rateBasisPoints(fund.rate) ?? 0,
    );
    group(fund.vatRate, fund.nature).taxableCents += contributionCents;
    return {
      type: fund.type,
      taxableCents,
      contributionCents,
      vatRate: fund.vatRate,
      ...(fund.nature && { nature: fund.nature }),
    };
  });
  // Withholdings apply to the lines and contributions marked as subject to them.
  const subjectCents =
    lines.reduce(
      (n, l, i) =>
        n + (input.lines[i]!.withholding === true ? l.lineTotalCents : 0),
      0,
    ) +
    adjustmentLines.reduce(
      (n, l) => n + (l.withholding ? l.amountCents : 0),
      0,
    ) +
    pensionFunds.reduce(
      (n, f, i) =>
        n +
        (input.pensionFunds![i]!.withholding === true
          ? f.contributionCents
          : 0),
      0,
    );
  const withholdings = (input.withholdings ?? []).map((withholding) => {
    const taxableCents = percentOf(
      subjectCents,
      rateBasisPoints(withholding.basePercent ?? 100) ?? 0,
    );
    return {
      type: withholding.type,
      rate: withholding.rate,
      reason: withholding.reason,
      taxableCents,
      amountCents: percentOf(
        taxableCents,
        rateBasisPoints(withholding.rate) ?? 0,
      ),
    };
  });
  const summary = [...groups.values()].sort(byRate).map((g) => ({
    ...g,
    vatCents: vatAmount(g.taxableCents, rateBasisPoints(g.vatRate) ?? 0),
  }));
  const taxableCents = summary.reduce((n, s) => n + s.taxableCents, 0);
  const vatCents = summary.reduce((n, s) => n + s.vatCents, 0);
  const totalCents = taxableCents + vatCents;
  const withholdingCents = withholdings.reduce((n, w) => n + w.amountCents, 0);
  const stampable = summary
    .filter((s) => s.nature && stampDutyNatures.includes(s.nature))
    .reduce((n, s) => n + s.taxableCents, 0);
  const stampDuty =
    input.stampDuty === "auto" || input.stampDuty === undefined
      ? stampable > stampDutyThresholdCents
      : input.stampDuty;
  return {
    totals: {
      lines,
      adjustmentLines,
      pensionFunds,
      withholdings,
      summary,
      taxableCents,
      vatCents,
      totalCents,
      withholdingCents,
      payableCents:
        totalCents -
        withholdingCents -
        (input.vatExigibility === "S" ? vatCents : 0),
      stampDutyCents: stampDuty ? stampDutyCents : 0,
    },
    unappliable,
  };
}

/**
 * Computes line totals and the VAT summary per rate and nature, as SDI recomputes them:
 * VAT is rounded once per rate on the summed taxable amount. Document adjustments are
 * spread over the rates and included, then pension fund contributions are added; withholdings
 * and the payable amount follow.
 */
export function computeTotals(input: TotalsInput): InvoiceTotals {
  return totalsWithIssues(input).totals;
}

/** Checks a VAT rate and nature, on a line or a pension fund. */
function checkVat(
  check: Checker,
  path: string,
  { vatRate, nature }: { vatRate: number; nature?: Nature },
  taxRegime: TaxRegime,
) {
  const basisPoints = rateBasisPoints(vatRate);
  if (basisPoints === undefined)
    check.add(
      `${path}.vatRate`,
      "must be a percentage between 0 and 100 with at most 2 decimals",
    );
  if (basisPoints === 0 && !nature)
    check.add(`${path}.nature`, "is required when the VAT rate is 0");
  if (basisPoints && nature)
    check.add(`${path}.nature`, "is only allowed when the VAT rate is 0");
  if (nature && !natures.includes(nature))
    check.add(`${path}.nature`, "is not a FatturaPA Natura code");
  if (taxRegime === "RF19" && (basisPoints || nature !== "N2.2"))
    check.add(
      `${path}.vatRate`,
      "flat-rate (RF19) sellers charge no VAT: use rate 0 with nature N2.2",
    );
}

/** Whether a percentage is above 0 and at most 100, with at most 2 decimals. */
function isPositivePercent(value: number): boolean {
  return !!rateBasisPoints(value);
}

/**
 * Checks the pension funds and withholdings, including the SDI consistency rules between
 * them and the lines. Returns the cleaned pension fund references.
 */
function checkWithholdings(
  check: Checker,
  input: InvoiceInput,
): (string | undefined)[] {
  const percentRule =
    "must be above 0 and at most 100, with at most 2 decimals";
  const withholdings = input.withholdings ?? [];
  const pensionFunds = input.pensionFunds ?? [];
  const seen = new Map<string, number>();
  withholdings.forEach((withholding, index) => {
    const at = `withholdings[${index}]`;
    if (!withholdingTypes.includes(withholding.type))
      check.add(`${at}.type`, "is not a FatturaPA TipoRitenuta code");
    else if (seen.has(withholding.type))
      check.add(
        `${at}.type`,
        `repeats withholdings[${seen.get(withholding.type)}]: SDI allows one withholding per type`,
      );
    else seen.set(withholding.type, index);
    if (!isPositivePercent(withholding.rate))
      check.add(`${at}.rate`, percentRule);
    if (!paymentReasons.includes(withholding.reason))
      check.add(`${at}.reason`, "is not a FatturaPA CausalePagamento code");
    if (
      withholding.basePercent !== undefined &&
      !isPositivePercent(withholding.basePercent)
    )
      check.add(`${at}.basePercent`, percentRule);
  });
  const references = pensionFunds.map((fund, index) => {
    const at = `pensionFunds[${index}]`;
    if (!pensionFundTypes.includes(fund.type))
      check.add(`${at}.type`, "is not a FatturaPA TipoCassa code");
    if (!isPositivePercent(fund.rate)) check.add(`${at}.rate`, percentRule);
    checkVat(check, at, fund, input.seller.taxRegime);
    if (fund.withholding !== undefined && typeof fund.withholding !== "boolean")
      check.add(`${at}.withholding`, "must be true or false");
    if (
      fund.taxableCents !== undefined &&
      (!Number.isSafeInteger(fund.taxableCents) || fund.taxableCents < 0)
    )
      check.add(`${at}.taxableCents`, "must be a non-negative integer");
    return check.optionalText(`${at}.reference`, fund.reference, 20, true);
  });
  // SDI rejects withholdings with nothing subject to them, and the reverse.
  const subject = [...input.lines, ...pensionFunds].some(
    (item) => item.withholding === true,
  );
  if (withholdings.length && !subject)
    check.add(
      "withholdings",
      "needs a line or pension fund with withholding: true",
    );
  if (!withholdings.length) {
    input.lines.forEach((line, index) => {
      if (line.withholding === true)
        check.add(
          `lines[${index}].withholding`,
          "needs the invoice's withholdings",
        );
    });
    pensionFunds.forEach((fund, index) => {
      if (fund.withholding === true)
        check.add(
          `pensionFunds[${index}].withholding`,
          "needs the invoice's withholdings",
        );
    });
  }
  return references;
}

/**
 * Validates an invoice and renders it as a FatturaPA FPR12 (private-sector) or FPA12 (public
 * administration) XML file, ready for an SDI channel or intermediary. Throws FatturaPAError
 * listing every problem.
 */
export function buildInvoice(input: InvoiceInput): Invoice {
  const check = new Checker();
  const type = input.type ?? "TD01";
  const format = input.format ?? "FPR12";
  const publicAdministration = format === "FPA12";
  if (format !== "FPR12" && !publicAdministration)
    check.add("format", 'must be "FPR12" or "FPA12"');
  const { seller, buyer, issuer, transmitter } = input;

  const number = check.text("number", input.number, 20, true);
  if (number && !/\d/.test(number))
    check.add("number", "must contain at least one digit");
  check.date("date", input.date);

  if (!/^[A-Za-z0-9]{1,5}$/.test(transmitter.sequence))
    check.add("transmitter.sequence", "must be 1-5 letters or digits");
  if (!/^[A-Z0-9]{11,16}$/.test(transmitter.code))
    check.add(
      "transmitter.code",
      "must be a Partita IVA or codice fiscale (11-16 characters)",
    );

  if (!isValidVatNumber(seller.vatNumber))
    check.add("seller.vatNumber", "is not a valid Partita IVA");
  if (seller.fiscalCode !== undefined && !isValidFiscalCode(seller.fiscalCode))
    check.add("seller.fiscalCode", "is not a valid codice fiscale");
  if (!taxRegimes.includes(seller.taxRegime))
    check.add("seller.taxRegime", "is not a FatturaPA RegimeFiscale code");
  const sellerName = check.text("seller.name", seller.name, 80);
  const sellerAddress = checkAddress(check, "seller.address", seller.address);
  const sellerAbroad = country(seller.address) !== "IT";
  const sellerEstablishment = checkEstablishment(
    check,
    "seller",
    seller,
    sellerAbroad,
  );
  const sellerRepresentative = checkRepresentative(
    check,
    "seller",
    seller,
    sellerAbroad,
  );

  const foreign = country(buyer.address) !== "IT";
  const buyerVatCountry = buyer.vatCountry ?? country(buyer.address);
  let buyerVatNumber = buyer.vatNumber;
  if (!/^[A-Z]{2}$/.test(buyerVatCountry))
    check.add("buyer.vatCountry", "must be an ISO 3166-1 alpha-2 code");
  if (foreign) {
    if (!buyer.vatNumber)
      check.add(
        "buyer.vatNumber",
        "is required for foreign buyers: their tax identifier or a conventional code",
      );
    if (buyer.fiscalCode !== undefined)
      check.add(
        "buyer.fiscalCode",
        "is only for Italian buyers: put a foreign tax identifier in vatNumber",
      );
  } else if (!buyer.vatNumber && !buyer.fiscalCode)
    check.add("buyer", "needs a vatNumber or a fiscalCode");
  if (buyer.vatNumber !== undefined) {
    if (buyerVatCountry === "IT") {
      if (!isValidVatNumber(buyer.vatNumber))
        check.add("buyer.vatNumber", "is not a valid Partita IVA");
    } else {
      buyerVatNumber = foreignVatNumber(buyer.vatNumber, buyerVatCountry);
      if (!/^[A-Z0-9]{1,28}$/.test(buyerVatNumber))
        check.add("buyer.vatNumber", "must be 1-28 letters or digits");
    }
  }
  if (buyer.fiscalCode !== undefined && !isValidFiscalCode(buyer.fiscalCode))
    check.add("buyer.fiscalCode", "is not a valid codice fiscale");
  const buyerName = check.text("buyer.name", buyer.name, 80);
  const buyerAddress = checkAddress(check, "buyer.address", buyer.address);
  const buyerEstablishment = checkEstablishment(check, "buyer", buyer, foreign);
  const buyerRepresentative = checkRepresentative(
    check,
    "buyer",
    buyer,
    foreign,
  );
  let recipientCode: string;
  if (publicAdministration) {
    recipientCode = buyer.recipientCode ?? "";
    if (foreign)
      check.add(
        "buyer.address.country",
        "must be IT: public administration (FPA12) buyers are Italian",
      );
    if (buyer.recipientCode === undefined)
      check.add(
        "buyer.recipientCode",
        "is required for FPA12: the 6-character codice univoco ufficio from IPA",
      );
    else if (!isValidRecipientCode(recipientCode, "FPA12"))
      check.add(
        "buyer.recipientCode",
        "must be the 6-character codice univoco ufficio from IPA for FPA12",
      );
    if (buyer.pec !== undefined)
      check.add(
        "buyer.pec",
        "is not used for FPA12: SDI delivers to the office's recipient code",
      );
  } else {
    recipientCode = buyer.recipientCode ?? (foreign ? "XXXXXXX" : "0000000");
    if (!isValidRecipientCode(recipientCode))
      check.add(
        "buyer.recipientCode",
        isValidRecipientCode(recipientCode, "FPA12")
          ? 'must be 7 upper-case letters or digits; 6-character codes are public administration offices: set format "FPA12"'
          : "must be 7 upper-case letters or digits",
      );
    else if (foreign !== (recipientCode === "XXXXXXX"))
      check.add(
        "buyer.recipientCode",
        foreign
          ? 'must be "XXXXXXX" for foreign buyers'
          : '"XXXXXXX" is only for foreign buyers',
      );
  }
  if (buyer.pec !== undefined && !publicAdministration) {
    if (recipientCode !== "0000000")
      check.add(
        "buyer.pec",
        'is used only when the recipient code is "0000000"',
      );
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.pec) || buyer.pec.length > 256)
      check.add("buyer.pec", "is not a valid email address");
  }

  let issuerName: string | undefined;
  if (issuer) {
    if (!isValidVatNumber(issuer.vatNumber))
      check.add("issuer.vatNumber", "is not a valid Partita IVA");
    if (
      issuer.fiscalCode !== undefined &&
      !isValidFiscalCode(issuer.fiscalCode)
    )
      check.add("issuer.fiscalCode", "is not a valid codice fiscale");
    issuerName = check.text("issuer.name", issuer.name, 80);
  }

  if (!input.lines.length) check.add("lines", "needs at least one line");
  if (input.lines.length > 9999)
    check.add("lines", "allows at most 9999 lines");
  const adjustmentDescriptions = (input.adjustments ?? []).map(
    (adjustment, index) => {
      const at = `adjustments[${index}]`;
      const { kind = "discount", percent, amountCents } = adjustment;
      if (kind !== "discount" && kind !== "surcharge")
        check.add(`${at}.kind`, 'must be "discount" or "surcharge"');
      if ((percent === undefined) === (amountCents === undefined))
        check.add(at, "needs exactly one of percent and amountCents");
      else if (percent !== undefined) {
        const bp = rateBasisPoints(
          percent,
          kind === "discount" ? 100 : maxPercent,
        );
        if (!bp)
          check.add(
            `${at}.percent`,
            `must be above 0 and at most ${kind === "discount" ? 100 : maxPercent}, with at most 2 decimals`,
          );
      } else if (!Number.isSafeInteger(amountCents) || amountCents! <= 0)
        check.add(`${at}.amountCents`, "must be a positive integer");
      return check.optionalText(
        `${at}.description`,
        adjustment.description,
        1000,
      );
    },
  );
  const lines = input.lines.map((line, index) => {
    const path = `lines[${index}]`;
    const quantity =
      line.quantity === undefined ? undefined : parseQuantity(line.quantity);
    if (line.quantity !== undefined && quantity === undefined)
      check.add(
        `${path}.quantity`,
        "must be a positive number with at most 12 digits and 8 decimals",
      );
    if (line.kind !== undefined && !Object.hasOwn(lineKindCodes, line.kind))
      check.add(
        `${path}.kind`,
        'must be "discount", "premium", "rebate" or "charge"',
      );
    if (!Number.isSafeInteger(line.unitPriceCents))
      check.add(`${path}.unitPriceCents`, "must be an integer");
    (line.adjustments ?? []).forEach((adjustment, i) => {
      const at = `${path}.adjustments[${i}]`;
      const { kind = "discount", percent, amountCents } = adjustment;
      if (kind !== "discount" && kind !== "surcharge")
        check.add(`${at}.kind`, 'must be "discount" or "surcharge"');
      if ((percent === undefined) === (amountCents === undefined))
        check.add(at, "needs exactly one of percent and amountCents");
      else if (percent !== undefined) {
        const bp = rateBasisPoints(
          percent,
          kind === "discount" ? 100 : maxPercent,
        );
        if (!bp)
          check.add(
            `${at}.percent`,
            `must be above 0 and at most ${kind === "discount" ? 100 : maxPercent}, with at most 2 decimals`,
          );
      } else if (!Number.isSafeInteger(amountCents) || amountCents! <= 0)
        check.add(`${at}.amountCents`, "must be a positive integer");
    });
    checkVat(check, path, line, seller.taxRegime);
    if (line.withholding !== undefined && typeof line.withholding !== "boolean")
      check.add(`${path}.withholding`, "must be true or false");
    return {
      quantity,
      description: check.text(`${path}.description`, line.description, 1000),
      unit: check.optionalText(`${path}.unit`, line.unit, 10, true),
      legalReference: check.optionalText(
        `${path}.legalReference`,
        line.legalReference,
        100,
      ),
    };
  });

  const pensionFundReferences = checkWithholdings(check, input);

  if ((type === "TD04" || type === "TD05") && !input.linkedInvoices?.length)
    check.add("linkedInvoices", "must reference the corrected invoice");
  const linkedInvoices = (input.linkedInvoices ?? []).map((linked, index) => {
    check.date(`linkedInvoices[${index}].date`, linked.date);
    return {
      number: check.text(
        `linkedInvoices[${index}].number`,
        linked.number,
        20,
        true,
      ),
      date: linked.date,
    };
  });
  const lineCount = input.lines.length;
  const orderReferences = checkReferences(
    check,
    "orderReference",
    input.orderReference,
    lineCount,
  );
  const contractReferences = checkReferences(
    check,
    "contractReference",
    input.contractReference,
    lineCount,
  );
  const agreementReferences = checkReferences(
    check,
    "agreementReference",
    input.agreementReference,
    lineCount,
  );
  const receiptReferences = checkReferences(
    check,
    "receiptReference",
    input.receiptReference,
    lineCount,
  );

  const payment = input.payment;
  const installments = payment?.installments;
  if (payment) {
    if (!paymentMethods.includes(payment.method))
      check.add("payment.method", "is not a FatturaPA ModalitaPagamento code");
    check.date("payment.dueDate", payment.dueDate);
    if (payment.iban !== undefined && !isValidIban(payment.iban))
      check.add("payment.iban", "is not a valid IBAN");
    if (installments) {
      if (payment.dueDate !== undefined)
        check.add(
          "payment.dueDate",
          "is not allowed with installments: give each instalment its own dueDate",
        );
      if (!installments.length)
        check.add("payment.installments", "needs at least 1 instalment");
      else if (payment.terms === "installments" && installments.length < 2)
        check.add(
          "payment.installments",
          'needs at least 2 instalments with terms "installments"',
        );
      installments.forEach((item, i) => {
        const at = `payment.installments[${i}]`;
        check.date(`${at}.dueDate`, item.dueDate);
        if (item.method !== undefined && !paymentMethods.includes(item.method))
          check.add(
            `${at}.method`,
            "is not a FatturaPA ModalitaPagamento code",
          );
        if (item.iban !== undefined && !isValidIban(item.iban))
          check.add(`${at}.iban`, "is not a valid IBAN");
        if (
          item.amountCents !== undefined &&
          (!Number.isSafeInteger(item.amountCents) || item.amountCents <= 0)
        )
          check.add(
            `${at}.amountCents`,
            "must be a positive integer number of cents",
          );
      });
    } else if (payment.terms === "installments")
      check.add("payment.installments", "is required for instalment terms");
  }
  const bank = check.optionalText("payment.bank", payment?.bank, 80);
  const beneficiary = check.optionalText(
    "payment.beneficiary",
    payment?.beneficiary,
    200,
  );
  const installmentTexts = (installments ?? []).map((item, i) => ({
    bank: check.optionalText(`payment.installments[${i}].bank`, item.bank, 80),
    beneficiary: check.optionalText(
      `payment.installments[${i}].beneficiary`,
      item.beneficiary,
      200,
    ),
  }));
  const description = cleanText(input.description ?? "");
  if (description.invalid)
    check.add(
      "description",
      `contains "${description.invalid}", which SDI does not accept`,
    );

  if (check.issues.length) throw new FatturaPAError(check.issues);

  const { totals, unappliable } = totalsWithIssues(input);
  for (const index of unappliable)
    check.add(
      `adjustments[${index}]`,
      "needs a positive taxable amount to apply to",
    );
  if (input.lines.length + totals.adjustmentLines.length > 9999)
    check.add("adjustments", "would take the invoice over 9999 lines");
  if (check.issues.length) throw new FatturaPAError(check.issues);
  if (type === "TD01" && totals.totalCents < 0)
    throw new FatturaPAError([
      { path: "lines", message: "an invoice total cannot be negative" },
    ]);
  if (type === "TD01" && totals.payableCents < 0)
    throw new FatturaPAError([
      {
        path: "withholdings",
        message: "the withholdings exceed the amount payable",
      },
    ]);

  let installmentAmounts: number[] = [];
  if (installments?.length) {
    const given = installments.filter((item) => item.amountCents !== undefined);
    if (given.length === 0)
      installmentAmounts = allocateCents(
        totals.payableCents,
        installments.map(() => 1),
      );
    else if (given.length < installments.length)
      check.add(
        "payment.installments",
        "must give amountCents on every instalment or on none",
      );
    else {
      installmentAmounts = installments.map((item) => item.amountCents!);
      if (installmentAmounts.reduce((n, a) => n + a, 0) !== totals.payableCents)
        check.add(
          "payment.installments",
          `must add up to the amount payable, ${formatCents(totals.payableCents)} EUR`,
        );
    }
    if (check.issues.length) throw new FatturaPAError(check.issues);
  }

  const idFiscale = (code: string, idCountry = "IT"): XmlNode[] => [
    ["IdPaese", idCountry],
    ["IdCodice", code],
  ];
  const sede = (a: ReturnType<typeof checkAddress>, tag = "Sede"): XmlNode => [
    tag,
    [
      ["Indirizzo", a.street],
      ["NumeroCivico", a.streetNumber],
      ["CAP", a.postalCode],
      ["Comune", a.city],
      ["Provincia", a.province],
      ["Nazione", a.country],
    ],
  ];
  const causali =
    description.text
      .match(/.{1,200}(?=\s|$)|.{1,200}/g)
      ?.map((part) => part.trim()) ?? [];

  const tree: XmlNode = [
    `p:FatturaElettronica versione="${format}" ${namespaces}`,
    [
      [
        "FatturaElettronicaHeader",
        [
          [
            "DatiTrasmissione",
            [
              [
                "IdTrasmittente",
                idFiscale(transmitter.code, transmitter.country),
              ],
              ["ProgressivoInvio", transmitter.sequence],
              ["FormatoTrasmissione", format],
              ["CodiceDestinatario", recipientCode],
              ["PECDestinatario", buyer.pec],
            ],
          ],
          [
            "CedentePrestatore",
            [
              [
                "DatiAnagrafici",
                [
                  ["IdFiscaleIVA", idFiscale(seller.vatNumber)],
                  ["CodiceFiscale", seller.fiscalCode],
                  ["Anagrafica", [["Denominazione", sellerName]]],
                  ["RegimeFiscale", seller.taxRegime],
                ],
              ],
              sede(sellerAddress),
              sellerEstablishment
                ? sede(sellerEstablishment, "StabileOrganizzazione")
                : undefined,
            ],
          ],
          sellerRepresentative
            ? [
                "RappresentanteFiscale",
                [
                  [
                    "DatiAnagrafici",
                    [
                      [
                        "IdFiscaleIVA",
                        idFiscale(
                          sellerRepresentative.vatNumber,
                          sellerRepresentative.vatCountry,
                        ),
                      ],
                      ["CodiceFiscale", sellerRepresentative.fiscalCode],
                      [
                        "Anagrafica",
                        [["Denominazione", sellerRepresentative.name]],
                      ],
                    ],
                  ],
                ],
              ]
            : undefined,
          [
            "CessionarioCommittente",
            [
              [
                "DatiAnagrafici",
                [
                  buyerVatNumber
                    ? [
                        "IdFiscaleIVA",
                        idFiscale(buyerVatNumber, buyerVatCountry),
                      ]
                    : undefined,
                  ["CodiceFiscale", buyer.fiscalCode],
                  ["Anagrafica", [["Denominazione", buyerName]]],
                ],
              ],
              sede(buyerAddress),
              buyerEstablishment
                ? sede(buyerEstablishment, "StabileOrganizzazione")
                : undefined,
              buyerRepresentative
                ? [
                    "RappresentanteFiscale",
                    [
                      [
                        "IdFiscaleIVA",
                        idFiscale(
                          buyerRepresentative.vatNumber,
                          buyerRepresentative.vatCountry,
                        ),
                      ],
                      ["Denominazione", buyerRepresentative.name],
                    ],
                  ]
                : undefined,
            ],
          ],
          issuer
            ? [
                "TerzoIntermediarioOSoggettoEmittente",
                [
                  [
                    "DatiAnagrafici",
                    [
                      ["IdFiscaleIVA", idFiscale(issuer.vatNumber)],
                      ["CodiceFiscale", issuer.fiscalCode],
                      ["Anagrafica", [["Denominazione", issuerName!]]],
                    ],
                  ],
                ],
              ]
            : undefined,
          ["SoggettoEmittente", issuer ? "TZ" : undefined],
        ],
      ],
      [
        "FatturaElettronicaBody",
        [
          [
            "DatiGenerali",
            [
              [
                "DatiGeneraliDocumento",
                [
                  ["TipoDocumento", type],
                  ["Divisa", "EUR"],
                  ["Data", input.date],
                  ["Numero", number],
                  ...totals.withholdings.map((w): XmlNode => [
                    "DatiRitenuta",
                    [
                      ["TipoRitenuta", w.type],
                      ["ImportoRitenuta", formatCents(w.amountCents)],
                      [
                        "AliquotaRitenuta",
                        formatCents(rateBasisPoints(w.rate)!),
                      ],
                      ["CausalePagamento", w.reason],
                    ],
                  ]),
                  totals.stampDutyCents
                    ? [
                        "DatiBollo",
                        [
                          ["BolloVirtuale", "SI"],
                          ["ImportoBollo", formatCents(totals.stampDutyCents)],
                        ],
                      ]
                    : undefined,
                  ...totals.pensionFunds.map((fund, index): XmlNode => {
                    const source = input.pensionFunds![index]!;
                    return [
                      "DatiCassaPrevidenziale",
                      [
                        ["TipoCassa", fund.type],
                        ["AlCassa", formatCents(rateBasisPoints(source.rate)!)],
                        [
                          "ImportoContributoCassa",
                          formatCents(fund.contributionCents),
                        ],
                        ["ImponibileCassa", formatCents(fund.taxableCents)],
                        [
                          "AliquotaIVA",
                          formatCents(rateBasisPoints(fund.vatRate)!),
                        ],
                        ["Ritenuta", source.withholding ? "SI" : undefined],
                        ["Natura", fund.nature],
                        [
                          "RiferimentoAmministrazione",
                          pensionFundReferences[index],
                        ],
                      ],
                    ];
                  }),
                  ["ImportoTotaleDocumento", formatCents(totals.totalCents)],
                  ...causali.map((c): XmlNode => ["Causale", c]),
                ],
              ],
              ...referenceNodes("DatiOrdineAcquisto", orderReferences),
              ...referenceNodes("DatiContratto", contractReferences),
              ...referenceNodes("DatiConvenzione", agreementReferences),
              ...referenceNodes("DatiRicezione", receiptReferences),
              ...linkedInvoices.map((linked): XmlNode => [
                "DatiFattureCollegate",
                [
                  ["IdDocumento", linked.number],
                  ["Data", linked.date],
                ],
              ]),
            ],
          ],
          [
            "DatiBeniServizi",
            [
              ...input.lines.map((line, index): XmlNode => {
                const clean = lines[index]!;
                return [
                  "DettaglioLinee",
                  [
                    ["NumeroLinea", String(index + 1)],
                    [
                      "TipoCessionePrestazione",
                      line.kind && lineKindCodes[line.kind],
                    ],
                    ["Descrizione", clean.description],
                    [
                      "Quantita",
                      clean.quantity === undefined
                        ? undefined
                        : formatQuantity(clean.quantity),
                    ],
                    ["UnitaMisura", clean.unit],
                    ["PrezzoUnitario", formatCents(line.unitPriceCents)],
                    ...(line.adjustments ?? []).map((a): XmlNode => [
                      "ScontoMaggiorazione",
                      [
                        ["Tipo", a.kind === "surcharge" ? "MG" : "SC"],
                        [
                          "Percentuale",
                          a.percent === undefined
                            ? undefined
                            : formatCents(
                                rateBasisPoints(a.percent, maxPercent)!,
                              ),
                        ],
                        [
                          "Importo",
                          a.amountCents === undefined
                            ? undefined
                            : formatCents(a.amountCents),
                        ],
                      ],
                    ]),
                    [
                      "PrezzoTotale",
                      formatCents(totals.lines[index]!.lineTotalCents),
                    ],
                    [
                      "AliquotaIVA",
                      formatCents(rateBasisPoints(line.vatRate)!),
                    ],
                    ["Ritenuta", line.withholding ? "SI" : undefined],
                    ["Natura", line.nature],
                  ],
                ];
              }),
              ...totals.adjustmentLines.map((line, index): XmlNode => {
                const adjustment = input.adjustments![line.adjustmentIndex]!;
                const surcharge = adjustment.kind === "surcharge";
                const spans =
                  totals.adjustmentLines.filter(
                    (l) => l.adjustmentIndex === line.adjustmentIndex,
                  ).length > 1;
                const suffix = [
                  adjustment.percent === undefined
                    ? ""
                    : ` ${formatPercent(rateBasisPoints(adjustment.percent, maxPercent)!)}%`,
                  !spans
                    ? ""
                    : line.nature
                      ? ` (${line.nature})`
                      : ` (IVA ${formatPercent(rateBasisPoints(line.vatRate)!)}%)`,
                ].join("");
                const name =
                  adjustmentDescriptions[line.adjustmentIndex] ??
                  (surcharge ? "Maggiorazione" : "Sconto");
                const price = formatCents(line.amountCents);
                return [
                  "DettaglioLinee",
                  [
                    ["NumeroLinea", String(input.lines.length + index + 1)],
                    ["TipoCessionePrestazione", surcharge ? "AC" : "SC"],
                    [
                      "Descrizione",
                      name.slice(0, 1000 - suffix.length) + suffix,
                    ],
                    ["PrezzoUnitario", price],
                    ["PrezzoTotale", price],
                    [
                      "AliquotaIVA",
                      formatCents(rateBasisPoints(line.vatRate)!),
                    ],
                    ["Ritenuta", line.withholding ? "SI" : undefined],
                    ["Natura", line.nature],
                  ],
                ];
              }),
              ...totals.summary.map((group): XmlNode => [
                "DatiRiepilogo",
                [
                  ["AliquotaIVA", formatCents(rateBasisPoints(group.vatRate)!)],
                  ["Natura", group.nature],
                  ["ImponibileImporto", formatCents(group.taxableCents)],
                  ["Imposta", formatCents(group.vatCents)],
                  [
                    "EsigibilitaIVA",
                    group.nature ? undefined : (input.vatExigibility ?? "I"),
                  ],
                  [
                    "RiferimentoNormativo",
                    group.legalReference &&
                      cleanText(group.legalReference).text,
                  ],
                ],
              ]),
            ],
          ],
          payment
            ? [
                "DatiPagamento",
                [
                  [
                    "CondizioniPagamento",
                    { full: "TP02", installments: "TP01", advance: "TP03" }[
                      payment.terms ?? (installments ? "installments" : "full")
                    ],
                  ],
                  ...(installments
                    ? installments.map((item, i): XmlNode => [
                        "DettaglioPagamento",
                        [
                          [
                            "Beneficiario",
                            installmentTexts[i]!.beneficiary ?? beneficiary,
                          ],
                          ["ModalitaPagamento", item.method ?? payment.method],
                          ["DataScadenzaPagamento", item.dueDate],
                          [
                            "ImportoPagamento",
                            formatCents(installmentAmounts[i]!),
                          ],
                          [
                            "IstitutoFinanziario",
                            installmentTexts[i]!.bank ?? bank,
                          ],
                          ["IBAN", item.iban ?? payment.iban],
                        ],
                      ])
                    : ([
                        [
                          "DettaglioPagamento",
                          [
                            ["Beneficiario", beneficiary],
                            ["ModalitaPagamento", payment.method],
                            ["DataScadenzaPagamento", payment.dueDate],
                            [
                              "ImportoPagamento",
                              formatCents(totals.payableCents),
                            ],
                            ["IstitutoFinanziario", bank],
                            ["IBAN", payment.iban],
                          ],
                        ],
                      ] as XmlNode[])),
                ],
              ]
            : undefined,
        ],
      ],
    ],
  ];

  return {
    ...totals,
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n${renderXml(tree)}`,
    fileName: `${transmitter.country ?? "IT"}${transmitter.code}_${transmitter.sequence}.xml`,
  };
}
