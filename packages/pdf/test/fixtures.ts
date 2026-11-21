import type { InvoiceInput } from "@lucianonerydev/fatturapa";

export const longDescription =
  "Direzione lavori e coordinamento della sicurezza in fase di esecuzione per la ristrutturazione dell'immobile di via Garibaldi 14, comprensivi di sopralluoghi settimanali, verbali e contabilità di cantiere";

// An engineer's invoice: Inarcassa 4%, ritenuta d'acconto 20% on the fee, two instalments.
export const professional: InvoiceInput = {
  number: "12/ING",
  date: "2026-10-20",
  seller: {
    vatNumber: "20000000008",
    fiscalCode: "RSSMRA80A01H501U",
    name: "Studio Ing. Mario Rossi",
    taxRegime: "RF01",
    address: {
      street: "Via Milano",
      streetNumber: "12",
      postalCode: "25126",
      city: "Brescia",
      province: "BS",
    },
  },
  buyer: {
    vatNumber: "10000000009",
    name: "Edilizia Bresciana Srl",
    pec: "amministrazione@pec.ediliziabresciana.it",
    address: {
      street: "Via Garibaldi 14",
      postalCode: "25122",
      city: "Brescia",
      province: "BS",
    },
  },
  transmitter: { code: "20000000008", sequence: "00012" },
  lines: [
    {
      description: longDescription,
      unitPriceCents: 250000,
      vatRate: 22,
      withholding: true,
    },
    {
      description: "Pratica SCIA (diritti di segreteria esclusi)",
      quantity: 1,
      unitPriceCents: 60000,
      vatRate: 22,
      withholding: true,
      adjustments: [{ percent: 10 }, { amountCents: 500 }],
    },
  ],
  pensionFunds: [{ type: "TC04", rate: 4, vatRate: 22 }],
  withholdings: [{ type: "RT01", rate: 20, reason: "A" }],
  description: "Saldo competenze professionali, incarico del 03/03/2026",
  orderReference: { id: "INC-2026/07", date: "2026-03-03" },
  payment: {
    method: "MP05",
    iban: "IT60X0542811101000000123456",
    bank: "Banca di Brescia",
    beneficiary: "Mario Rossi",
    installments: [
      { dueDate: "2026-11-19", amountCents: 150000 },
      { dueDate: "2026-12-19", amountCents: 174381 },
    ],
  },
};

// A public administration invoice with CIG and CUP, split payment.
export const publicAdministration: InvoiceInput = {
  format: "FPA12",
  number: "3/PA",
  date: "2026-10-20",
  seller: {
    vatNumber: "20000000008",
    name: "Ristorazione Collettiva Lombarda Srl",
    taxRegime: "RF01",
    address: {
      street: "Via Milano 12",
      postalCode: "25126",
      city: "Brescia",
      province: "BS",
    },
  },
  buyer: {
    fiscalCode: "80012000826",
    name: "Comune di Esempio",
    recipientCode: "UF7Q2K",
    address: {
      street: "Piazza Municipio 1",
      postalCode: "25126",
      city: "Brescia",
      province: "BS",
    },
  },
  transmitter: { code: "20000000008", sequence: "00003" },
  vatExigibility: "S",
  contractReference: {
    id: "REP. 45/2026",
    date: "2026-09-15",
    itemCode: "Fornitura mensa scolastica",
    cup: "J41B26000120004",
    cig: "Z1A2B3C4D5",
  },
  lines: [
    {
      description: "Pasti mensa scolastica, ottobre 2026",
      quantity: 1240,
      unit: "pasti",
      unitPriceCents: 485,
      vatRate: 4,
    },
    {
      description: "Servizio di sporzionamento",
      quantity: "22.5",
      unit: "ore",
      unitPriceCents: 2800,
      vatRate: 22,
    },
  ],
  adjustments: [{ percent: 2, description: "Sconto contrattuale" }],
  payment: {
    method: "MP05",
    dueDate: "2026-11-19",
    iban: "IT60X0542811101000000123456",
  },
};

// A foreign buyer: intra-EU supply, not taxable, with a third-party issuer.
export const foreignBuyer: InvoiceInput = {
  number: "7/EU",
  date: "2026-10-20",
  seller: {
    vatNumber: "20000000008",
    name: "Macelleria Bresciana Srl",
    taxRegime: "RF01",
    address: {
      street: "Via Milano 12",
      postalCode: "25126",
      city: "Brescia",
      province: "BS",
    },
  },
  buyer: {
    vatNumber: "DE 123456789",
    name: "Gasthaus Zur Linde GmbH",
    address: {
      street: "Lindenstraße 5",
      postalCode: "10115",
      city: "Berlin",
      country: "DE",
    },
  },
  issuer: { vatNumber: "50000000005", name: "Mercato Digitale Srl" },
  transmitter: { code: "50000000005", sequence: "00007" },
  lines: [
    {
      description: "Controfiletto di manzo (sottovuoto) - lotto \\A12\\",
      quantity: "3.5",
      unit: "kg",
      unitPriceCents: 2490,
      vatRate: 0,
      nature: "N3.2",
      legalReference: "Art. 41, DL 331/1993",
    },
  ],
  payment: { method: "MP08", dueDate: "2026-10-20" },
};

/** An invoice with `count` lines, to exercise pagination. */
export function manyLines(count: number): InvoiceInput {
  return {
    ...foreignBuyer,
    number: "120/MZ",
    buyer: {
      vatNumber: "10000000009",
      name: "Trattoria Il Portico",
      address: {
        street: "Via Milano 10",
        postalCode: "25126",
        city: "Brescia",
        province: "BS",
      },
    },
    lines: Array.from({ length: count }, (_, i) => ({
      description:
        i % 7 === 3
          ? `Articolo ${i + 1}: selezione di salumi e formaggi stagionati del territorio bresciano, confezione regalo`
          : `Articolo ${i + 1}`,
      quantity: (i % 5) + 1,
      unit: "pz",
      unitPriceCents: 1000 + i * 37,
      vatRate: i % 2 ? 10 : 22,
    })),
  };
}
