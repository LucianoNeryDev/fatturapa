/**
 * Reads the FatturaPA XML that buildInvoice generates, so the PDF shows exactly the text the
 * XML carries (cleaned descriptions, compacted identifiers, generated adjustment lines). It
 * handles elements, text and the predefined and numeric entities; attributes, comments and
 * processing instructions are skipped.
 */

export interface XmlElement {
  /** Local name, without the namespace prefix. */
  name: string;
  children: XmlElement[];
  text: string;
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (match, entity) => {
    if (entity.startsWith("#x"))
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#"))
      return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return entities[entity] ?? match;
  });
}

export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: "", children: [], text: "" };
  const stack = [root];
  const tokens =
    /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<(\/?)([^\s/>]+)[^>]*?(\/?)>|([^<]+)/g;
  for (const [, closing, tag, selfClosing, text] of xml.matchAll(tokens)) {
    const current = stack[stack.length - 1]!;
    if (text !== undefined) current.text += decode(text);
    else if (tag === undefined) continue;
    else if (closing) {
      if (stack.length > 1) stack.pop();
    } else {
      const element: XmlElement = {
        name: tag.replace(/^.*:/, ""),
        children: [],
        text: "",
      };
      current.children.push(element);
      if (!selfClosing) stack.push(element);
    }
  }
  const document = root.children[0];
  if (!document) throw new Error("The XML has no root element");
  return document;
}

/** All descendants along a slash-separated path of child names. */
export function findAll(
  element: XmlElement | undefined,
  path: string,
): XmlElement[] {
  let level = element ? [element] : [];
  for (const name of path.split("/"))
    level = level.flatMap((e) => e.children.filter((c) => c.name === name));
  return level;
}

export function find(
  element: XmlElement | undefined,
  path: string,
): XmlElement | undefined {
  return findAll(element, path)[0];
}

/** Trimmed text of the first element at `path`, or undefined when absent or empty. */
export function textAt(
  element: XmlElement | undefined,
  path: string,
): string | undefined {
  const text = find(element, path)?.text.trim();
  return text ? text : undefined;
}
