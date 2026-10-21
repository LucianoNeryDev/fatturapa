/** An element with text, child elements, or nothing (omitted from the output). */
export type XmlNode = [
  name: string,
  content: string | undefined | (XmlNode | undefined)[],
];

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => entities[c]!);
}

/** Renders an element tree with two-space indentation, skipping undefined elements. */
export function renderXml(node: XmlNode, depth = 0): string {
  const [name, content] = node;
  const indent = "  ".repeat(depth);
  if (typeof content === "string")
    return `${indent}<${name}>${escapeXml(content)}</${name}>\n`;
  const children = (content ?? []).filter((c): c is XmlNode => !!c);
  if (!children.length) return "";
  const close = name.split(" ")[0];
  return `${indent}<${name}>\n${children.map((c) => renderXml(c, depth + 1)).join("")}${indent}</${close}>\n`;
}

const replacements: [RegExp, string][] = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[‐-―−]/g, "-"],
  [/…/g, "..."],
  [/€/g, "EUR"],
  [/•/g, "-"],
];

/**
 * Prepares free text for FatturaPA: replaces typographic punctuation with ASCII, collapses
 * whitespace, and reports characters outside Latin-1 (the only ones SDI accepts).
 */
export function cleanText(
  value: string,
  ascii = false,
): { text: string; invalid?: string } {
  let text = value.normalize("NFC");
  for (const [pattern, replacement] of replacements)
    text = text.replace(pattern, replacement);
  text = text.replace(/\s+/g, " ").trim();
  const invalid = [...text].find((c) => {
    const code = c.codePointAt(0)!;
    return code < 0x20 || code > (ascii ? 0x7e : 0xff);
  });
  return invalid ? { text, invalid } : { text };
}
