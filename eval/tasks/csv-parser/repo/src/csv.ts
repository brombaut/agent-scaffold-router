/** Parses CSV text into rows of fields. A trailing newline does not add an empty row. */
export function parseCSV(text: string): string[][] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split(","));
}
