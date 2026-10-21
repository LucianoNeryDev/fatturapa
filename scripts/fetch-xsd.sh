#!/bin/sh
# Downloads the official FatturaPA 1.2.2 schema and the XML Signature schema it imports into
# .xsd/, pointing the import at the local copy so xmllint can validate offline.
set -eu
dir="$(dirname "$0")/../.xsd"
mkdir -p "$dir"
[ -s "$dir/fatturapa.xsd" ] && exit 0
curl -fsSL -o "$dir/xmldsig-core-schema.xsd" \
  https://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd
curl -fsSL -o "$dir/official.xsd" \
  https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.2.2/Schema_del_file_xml_FatturaPA_v1.2.2.xsd
sed 's#schemaLocation="http://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd"#schemaLocation="xmldsig-core-schema.xsd"#' \
  "$dir/official.xsd" > "$dir/fatturapa.xsd"
grep -q 'schemaLocation="xmldsig-core-schema.xsd"' "$dir/fatturapa.xsd"
