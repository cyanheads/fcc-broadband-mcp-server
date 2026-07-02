/**
 * @fileoverview Minimal RFC 4180 CSV parser for Socrata CSV export pages.
 * Handles quoted fields, escaped quotes (`""`), embedded commas/newlines, and
 * CRLF line endings. Returns one object per data row keyed by the header row.
 * @module services/open-data/mirror/csv
 */

/** Parse a full CSV document into records keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  if (inQuotes) {
    throw new Error('Malformed CSV: unterminated quoted field.');
  }

  const [header, ...data] = rows;
  if (!header) return [];
  return data.map((cells) => {
    const record: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      record[header[i] as string] = cells[i] ?? '';
    }
    return record;
  });
}
