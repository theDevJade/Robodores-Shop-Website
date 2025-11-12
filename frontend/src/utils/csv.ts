export type CsvRecord = Record<string, string>;

export type ParsedCsv = {
  headers: string[];
  records: CsvRecord[];
};

export function createRowAccessor(record: CsvRecord) {
  const normalized = new Map<string, string>();
  Object.entries(record).forEach(([key, value]) => {
    normalized.set(key, value);
    normalized.set(key.toLowerCase(), value);
  });
  return (name: string) => normalized.get(name) ?? normalized.get(name.toLowerCase()) ?? "";
}

export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let current: string[] = [];
  let value = "";
  let inQuotes = false;

  const pushValue = () => {
    current.push(value);
    value = "";
  };

  const pushRow = () => {
    if (current.length === 0) return;
    rows.push(current);
    current = [];
  };

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      pushValue();
      continue;
    }

    if (char === "\n" && !inQuotes) {
      pushValue();
      pushRow();
      continue;
    }

    value += char;
  }

  if (value || current.length) {
    pushValue();
    pushRow();
  }

  if (!rows.length) {
    return { headers: [], records: [] };
  }

  const headerRow = rows[0].map((cell) => cell.trim());
  const records = rows.slice(1).reduce<CsvRecord[]>((acc, row) => {
    const hasContent = row.some((cell) => cell.trim().length);
    if (!hasContent) return acc;
    const record: CsvRecord = {};
    headerRow.forEach((header, idx) => {
      if (!header) return;
      record[header] = row[idx]?.trim() ?? "";
    });
    acc.push(record);
    return acc;
  }, []);

  return { headers: headerRow, records };
}
