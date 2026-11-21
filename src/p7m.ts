/**
 * Extraction of the signed content of a CAdES-BES (.p7m) envelope: a CMS ContentInfo holding a
 * SignedData (RFC 5652). The ASN.1 is walked as BER, so both DER and the indefinite lengths and
 * segmented OCTET STRINGs some signing tools produce are accepted. The signature is NOT
 * verified: the content is returned as is.
 */

/** A .p7m that cannot be read, with the reason. */
export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeError";
  }
}

interface Tlv {
  /** The identifier octet: class, constructed bit and tag number below 31. */
  identifier: number;
  constructed: boolean;
  contentStart: number;
  contentEnd: number;
  end: number;
}

const maxDepth = 32;
/** 1.2.840.113549.1.7.2, id-signedData. */
const signedDataOid = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];

const SEQUENCE = 0x30;
const OID = 0x06;
const OCTET_STRING = 0x04;
const CONSTRUCTED_OCTET_STRING = 0x24;
const CONTEXT_0 = 0xa0;

function readTlv(
  bytes: Uint8Array,
  pos: number,
  limit: number,
  depth: number,
): Tlv {
  if (depth > maxDepth) throw new EnvelopeError("ASN.1 nested too deeply");
  if (pos >= limit) throw new EnvelopeError("truncated ASN.1 data");
  const identifier = bytes[pos]!;
  let p = pos + 1;
  if ((identifier & 0x1f) === 0x1f) {
    // High tag number form: base-128 digits, the last without the top bit.
    let digits = 0;
    do {
      if (p >= limit || ++digits > 4)
        throw new EnvelopeError("invalid ASN.1 tag");
    } while (bytes[p++]! & 0x80);
  }
  if (p >= limit) throw new EnvelopeError("truncated ASN.1 data");
  const constructed = (identifier & 0x20) !== 0;
  const first = bytes[p++]!;
  if (first === 0x80) {
    if (!constructed)
      throw new EnvelopeError("indefinite length on a primitive ASN.1 value");
    // Indefinite length: the content runs to an end-of-contents marker (00 00).
    let q = p;
    for (;;) {
      if (q + 2 > limit) throw new EnvelopeError("truncated ASN.1 data");
      if (bytes[q] === 0 && bytes[q + 1] === 0)
        return {
          identifier,
          constructed,
          contentStart: p,
          contentEnd: q,
          end: q + 2,
        };
      q = readTlv(bytes, q, limit, depth + 1).end;
    }
  }
  let length = first;
  if (first > 0x80) {
    const count = first & 0x7f;
    if (count > 4) throw new EnvelopeError("ASN.1 length too large");
    length = 0;
    for (let i = 0; i < count; i++) {
      if (p >= limit) throw new EnvelopeError("truncated ASN.1 data");
      length = length * 256 + bytes[p++]!;
    }
  }
  if (p + length > limit) throw new EnvelopeError("truncated ASN.1 data");
  return {
    identifier,
    constructed,
    contentStart: p,
    contentEnd: p + length,
    end: p + length,
  };
}

function childrenOf(bytes: Uint8Array, tlv: Tlv, depth: number): Tlv[] {
  const children: Tlv[] = [];
  if (!tlv.constructed) return children;
  for (let pos = tlv.contentStart; pos < tlv.contentEnd;) {
    const child = readTlv(bytes, pos, tlv.contentEnd, depth);
    children.push(child);
    pos = child.end;
  }
  return children;
}

/** Collects the segments of a primitive or constructed OCTET STRING. */
function octets(
  bytes: Uint8Array,
  tlv: Tlv,
  parts: Uint8Array[],
  depth: number,
): void {
  if (tlv.identifier === OCTET_STRING)
    parts.push(bytes.subarray(tlv.contentStart, tlv.contentEnd));
  else if (tlv.identifier === CONSTRUCTED_OCTET_STRING)
    for (const child of childrenOf(bytes, tlv, depth + 1))
      octets(bytes, child, parts, depth + 1);
  else throw new EnvelopeError("the signed content is not an OCTET STRING");
}

/**
 * Returns the content signed in a CAdES (.p7m) file: ContentInfo → SignedData →
 * encapContentInfo → eContent. Throws EnvelopeError when the bytes are not an attached
 * SignedData. Does not verify the signature or the certificates.
 */
export function extractSignedContent(bytes: Uint8Array): Uint8Array {
  const contentInfo = readTlv(bytes, 0, bytes.length, 0);
  if (contentInfo.identifier !== SEQUENCE)
    throw new EnvelopeError("not a CMS ContentInfo");
  const [type, explicit] = childrenOf(bytes, contentInfo, 1);
  const oid =
    type?.identifier === OID
      ? bytes.subarray(type.contentStart, type.contentEnd)
      : undefined;
  if (
    !oid ||
    oid.length !== signedDataOid.length ||
    oid.some((b, i) => b !== signedDataOid[i])
  )
    throw new EnvelopeError("not a CMS SignedData (PKCS#7 signed file)");
  if (explicit?.identifier !== CONTEXT_0)
    throw new EnvelopeError("SignedData content is missing");
  const [signedData] = childrenOf(bytes, explicit, 2);
  if (signedData?.identifier !== SEQUENCE)
    throw new EnvelopeError("SignedData is not a SEQUENCE");
  // SignedData: version, digestAlgorithms, encapContentInfo, ...
  const encapContentInfo = childrenOf(bytes, signedData, 3)[2];
  if (encapContentInfo?.identifier !== SEQUENCE)
    throw new EnvelopeError("encapContentInfo is missing");
  const eContent = childrenOf(bytes, encapContentInfo, 4)[1];
  if (eContent === undefined)
    throw new EnvelopeError(
      "detached signature: the .p7m does not contain the signed file",
    );
  if (eContent.identifier !== CONTEXT_0)
    throw new EnvelopeError("eContent is not tagged [0]");
  const [octetString] = childrenOf(bytes, eContent, 5);
  if (!octetString) throw new EnvelopeError("eContent is empty");
  const parts: Uint8Array[] = [];
  octets(bytes, octetString, parts, 6);
  if (parts.length === 1) return parts[0]!.slice();
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
