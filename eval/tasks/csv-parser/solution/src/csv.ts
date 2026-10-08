/** Parses CSV text into rows of fields. A trailing newline does not add an empty row. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') inQuotes = false;
      else field += ch;
      i++;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") endField();
    else if (ch === "\r" && text[i + 1] === "\n") {
      endRow();
      i++;
    } else if (ch === "\n") endRow();
    else field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
