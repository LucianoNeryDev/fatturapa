/**
 * A minimal, non-validating XML parser for FatturaPA files: elements, attributes, text, CDATA,
 * comments, processing instructions and the XML declaration. Only the five predefined entities
 * and numeric character references are expanded. Any DOCTYPE is rejected, so there is no entity
 * expansion and no external entity resolution (no XXE, no billion laughs).
 */

/** An element, with namespace prefixes stripped from its name and attribute names. */
export interface XmlElement {
  /** Local name, e.g. "FatturaElettronica" for `<p:FatturaElettronica>`. */
  name: string;
  /** Attributes by local name; namespace declarations (`xmlns`, `xmlns:*`) are left out. */
  attributes: Record<string, string>;
  children: XmlElement[];
  /** The element's text and CDATA, concatenated, with entities decoded. */
  text: string;
}

/** Malformed XML, with the 1-based line and column of the problem. */
export class XmlSyntaxError extends Error {
  constructor(
    readonly reason: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`line ${line}, column ${column}: ${reason}`);
    this.name = "XmlSyntaxError";
  }
}

const namePattern = /[A-Za-z_:À-￿][-A-Za-z0-9_.:·À-￿]*/y;
const whitespacePattern = /[ \t\r\n]*/y;
const predefined: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function localName(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1);
}

function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

interface Open {
  element: XmlElement;
  /** The name as written, prefix included, to match the end tag. */
  raw: string;
  text: string[];
}

/**
 * Parses an XML document into its root element. Runs in linear time and rejects elements
 * nested deeper than `maxDepth`. Throws XmlSyntaxError on malformed input.
 */
export function parseXml(source: string, maxDepth = 100): XmlElement {
  let pos = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const start = pos;
  const length = source.length;
  const stack: Open[] = [];
  let root: XmlElement | undefined;

  const fail = (reason: string, at = pos): never => {
    let line = 1;
    let lineStart = 0;
    for (let i = source.indexOf("\n"); i !== -1 && i < at;) {
      line++;
      lineStart = i + 1;
      i = source.indexOf("\n", i + 1);
    }
    throw new XmlSyntaxError(reason, line, at - lineStart + 1);
  };

  const readName = (what: string): string => {
    namePattern.lastIndex = pos;
    const match = namePattern.exec(source);
    if (!match) fail(`expected ${what}`);
    pos += match![0].length;
    return match![0];
  };

  const skipWhitespace = () => {
    whitespacePattern.lastIndex = pos;
    whitespacePattern.exec(source);
    pos = whitespacePattern.lastIndex;
  };

  /** Normalises line ends and expands entity and character references. */
  const decode = (raw: string, offset: number): string => {
    const text = raw.includes("\r") ? raw.replace(/\r\n?/g, "\n") : raw;
    if (!text.includes("&")) return text;
    const parts: string[] = [];
    let last = 0;
    for (let i = text.indexOf("&"); i !== -1; i = text.indexOf("&", last)) {
      parts.push(text.slice(last, i));
      const semicolon = text.indexOf(";", i);
      const reference =
        semicolon === -1 || semicolon - i > 12
          ? undefined
          : text.slice(i + 1, semicolon);
      // Offsets are approximate when CR LF pairs precede the reference.
      const at = offset + i;
      if (reference === undefined)
        fail('"&" must start an entity or character reference', at);
      const named = predefined[reference!];
      if (named !== undefined) parts.push(named);
      else {
        const match = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(
          reference!,
        );
        if (!match)
          fail(
            `unknown entity "&${reference};": only the predefined entities are allowed`,
            at,
          );
        const code =
          match![1] !== undefined
            ? parseInt(match![1], 16)
            : parseInt(match![2]!, 10);
        if (!isXmlChar(code))
          fail(`character reference "&${reference};" is not allowed`, at);
        parts.push(String.fromCodePoint(code));
      }
      last = semicolon + 1;
    }
    parts.push(text.slice(last));
    return parts.join("");
  };

  const closeElement = () => {
    const open = stack.pop()!;
    open.element.text = open.text.join("");
    if (!stack.length) root = open.element;
  };

  while (pos < length) {
    const lt = source.indexOf("<", pos);
    const end = lt === -1 ? length : lt;
    if (end > pos) {
      const top = stack[stack.length - 1];
      if (top) top.text.push(decode(source.slice(pos, end), pos));
      else if (/[^ \t\r\n]/.test(source.slice(pos, end))) {
        const offset = source.slice(pos, end).search(/[^ \t\r\n]/);
        fail(
          root ? "text after the root element" : "text before the root element",
          pos + offset,
        );
      }
    }
    if (lt === -1) break;
    pos = lt;

    if (source.startsWith("<!--", pos)) {
      const close = source.indexOf("-->", pos + 4);
      if (close === -1) fail("unterminated comment");
      pos = close + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", pos)) {
      const top = stack[stack.length - 1];
      if (!top) fail("CDATA section outside the root element");
      const close = source.indexOf("]]>", pos + 9);
      if (close === -1) fail("unterminated CDATA section");
      top!.text.push(source.slice(pos + 9, close).replace(/\r\n?/g, "\n"));
      pos = close + 3;
      continue;
    }
    if (source.startsWith("<!DOCTYPE", pos))
      fail(
        "DOCTYPE declarations are not allowed: FatturaPA files have no DTD, and entities are not expanded",
      );
    if (source.startsWith("<!", pos)) fail("unexpected markup declaration");
    if (source.startsWith("<?", pos)) {
      const at = pos;
      pos += 2;
      const target = readName("a processing instruction target");
      const close = source.indexOf("?>", pos);
      if (close === -1) fail("unterminated processing instruction", at);
      if (target.toLowerCase() === "xml" && at !== start)
        fail("the XML declaration must come first", at);
      pos = close + 2;
      continue;
    }
    if (source.startsWith("</", pos)) {
      const at = pos;
      pos += 2;
      const name = readName("an element name");
      skipWhitespace();
      if (source[pos] !== ">") fail('expected ">"');
      const top = stack[stack.length - 1];
      if (!top) fail(`unexpected end tag </${name}>`, at);
      if (top!.raw !== name)
        fail(`expected </${top!.raw}>, found </${name}>`, at);
      pos++;
      closeElement();
      continue;
    }

    // Start tag.
    const at = pos;
    pos++;
    if (root) fail("more than one root element", at);
    if (stack.length >= maxDepth)
      fail(`elements are nested deeper than ${maxDepth} levels`, at);
    const raw = readName("an element name");
    const element: XmlElement = {
      name: localName(raw),
      attributes: {},
      children: [],
      text: "",
    };
    const seen = new Set<string>();
    for (;;) {
      const before = pos;
      skipWhitespace();
      if (source.startsWith("/>", pos) || source[pos] === ">") break;
      if (pos === before) fail('expected whitespace, ">" or "/>"');
      const attribute = readName("an attribute name");
      if (seen.has(attribute)) fail(`duplicate attribute "${attribute}"`);
      seen.add(attribute);
      skipWhitespace();
      if (source[pos] !== "=") fail('expected "="');
      pos++;
      skipWhitespace();
      const quote = source[pos];
      if (quote !== '"' && quote !== "'") fail("expected a quoted value");
      const close = source.indexOf(quote!, pos + 1);
      if (close === -1) fail("unterminated attribute value");
      const value = source.slice(pos + 1, close);
      const bracket = value.indexOf("<");
      if (bracket !== -1)
        fail('"<" is not allowed in an attribute value', pos + 1 + bracket);
      if (attribute !== "xmlns" && !attribute.startsWith("xmlns:"))
        element.attributes[localName(attribute)] = decode(
          value,
          pos + 1,
        ).replace(/[\t\n]/g, " ");
      pos = close + 1;
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.element.children.push(element);
    stack.push({ element, raw, text: [] });
    if (source[pos] === "/") {
      pos += 2;
      closeElement();
    } else pos++;
  }

  if (stack.length)
    fail(`unclosed element <${stack[stack.length - 1]!.raw}>`, length);
  if (!root) fail("no root element", length);
  return root!;
}
