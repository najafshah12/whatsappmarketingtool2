import { inflateRawSync } from "node:zlib";
import { posix } from "node:path";

export type SpreadsheetTable = {
  /** Header labels when the first row looks like a header, otherwise null. */
  headers: string[] | null;
  /** Data rows only (header excluded). */
  rows: string[][];
  /** Original 1-based row numbers, kept even when blank rows are omitted. */
  rowNumbers: number[];
  /** 1-based spreadsheet row number of the first data row. */
  firstDataRow: number;
};

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

function collectText(xml: string) {
  return [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(match => decodeXml(match[1])).join("");
}

/** Reads a ZIP archive into a name → utf8 text map (deflate or stored entries). */
function readZip(buffer: Buffer) {
  const entries = new Map<string, string>();
  const maxEntryBytes = 12 * 1024 * 1024;
  const maxExpandedBytes = 24 * 1024 * 1024;
  let expandedBytes = 0;
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0 && offset >= buffer.length - 66_000; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("This file is not a valid .xlsx workbook (ZIP structure not found).");

  const count = buffer.readUInt16LE(eocd + 10);
  if (count > 10_000) throw new Error("This workbook contains too many ZIP entries to import safely.");
  let pointer = buffer.readUInt32LE(eocd + 16);

  for (let index = 0; index < count; index++) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) {
      throw new Error("This file has an invalid .xlsx ZIP directory.");
    }
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const recordEnd = pointer + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > buffer.length) throw new Error("This file has an incomplete .xlsx ZIP directory.");
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLength);
    const needed = name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels" || name === "xl/sharedStrings.xml"
      || /^xl\/worksheets\/[^/]+\.xml$/i.test(name);

    if (needed) {
      if (compressedSize > buffer.length || localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error("This file has an invalid .xlsx worksheet entry.");
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > buffer.length) throw new Error("This file has an incomplete .xlsx worksheet entry.");
      const raw = buffer.subarray(dataStart, dataStart + compressedSize);
      try {
        const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: maxEntryBytes }) : null;
        if (!data) throw new Error("Unsupported ZIP compression method.");
        if (data.length > maxEntryBytes || expandedBytes + data.length > maxExpandedBytes) {
          throw new Error("This workbook expands beyond the safe import size limit.");
        }
        expandedBytes += data.length;
        entries.set(name, data.toString("utf8"));
      } catch (error) {
        if (error instanceof Error && error.message.includes("safe import size")) throw error;
        throw new Error("Could not decompress an .xlsx workbook entry.");
      }
    }
    pointer = recordEnd;
  }
  return entries;
}

function firstSheetPath(entries: Map<string, string>) {
  const workbook = entries.get("xl/workbook.xml");
  if (!workbook) throw new Error("The workbook is missing xl/workbook.xml.");
  const sheet = /<sheet\b[^>]*\br:id="([^"]+)"/i.exec(workbook) || /<sheet\b[^>]*\bsheetId="([^"]+)"/i.exec(workbook);
  const relationshipId = sheet?.[1];
  const rels = entries.get("xl/_rels/workbook.xml.rels");
  if (relationshipId && rels) {
    const relation = new RegExp(`<Relationship\\b[^>]*\\bId="${relationshipId}"[^>]*>`, "i").exec(rels)?.[0]
      || new RegExp(`<Relationship\\b[^>]*\\bId="${relationshipId}"[^>]*/>`, "i").exec(rels)?.[0];
    const target = relation ? /\bTarget="([^"]+)"/i.exec(relation)?.[1] : undefined;
    if (target) {
      const normalised = posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join("xl", target));
      if (entries.has(normalised)) return normalised;
    }
  }
  return "xl/worksheets/sheet1.xml";
}

function columnIndex(reference: string) {
  const letters = /^[A-Z]+/i.exec(reference)?.[0]?.toUpperCase() ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function parseSheet(xml: string, shared: string[]) {
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  const rowMatches = xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g);
  for (const rowMatch of rowMatches) {
    const cells: string[] = [];
    const rowNumber = Number(/\br="(\d+)"/i.exec(rowMatch[0].slice(0, rowMatch[0].indexOf(">")))?.[1]) || rowNumbers.length + 1;
    const cellMatches = rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g);
    for (const cell of cellMatches) {
      const attributes = cell[1] || "";
      const inner = cell[2] || "";
      const reference = /\br="([A-Z]+\d+)"/i.exec(attributes)?.[1];
      const type = /\bt="([^"]+)"/i.exec(attributes)?.[1];
      const rawValue = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(rawValue)] ?? "";
      else if (type === "inlineStr") value = collectText(inner);
      else if (type === "str") value = rawValue ? decodeXml(rawValue) : collectText(inner);
      else if (type === "b") value = rawValue === "1" ? "TRUE" : "FALSE";
      else value = rawValue ?? collectText(inner);
      const target = reference ? columnIndex(reference) : cells.length;
      while (cells.length < target) cells.push("");
      cells[target] = String(value).trim();
    }
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.some(cell => cell !== "")) {
      rows.push(cells);
      rowNumbers.push(rowNumber);
    }
  }
  return { rows, rowNumbers };
}

function countOutsideQuotes(text: string, delimiter: string) {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '"' && quoted && text[index + 1] === '"') index++;
    else if (text[index] === '"') quoted = !quoted;
    else if (text[index] === delimiter && !quoted) count++;
  }
  return count;
}

function parseDelimited(text: string) {
  const clean = text.replace(/^\uFEFF/, "");
  const sample = clean.slice(0, 4000);
  const counts = [
    { delimiter: ",", count: countOutsideQuotes(sample, ",") },
    { delimiter: ";", count: countOutsideQuotes(sample, ";") },
    { delimiter: "\t", count: countOutsideQuotes(sample, "\t") },
  ].sort((a, b) => b.count - a.count);
  const delimiter = counts[0].count > 0 ? counts[0].delimiter : ",";

  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let lineNumber = 1;
  let rowStartLine = 1;
  for (let index = 0; index < clean.length; index++) {
    const char = clean[index];
    if (char === '"' && quoted && clean[index + 1] === '"') {
      cell += '"';
      index++;
    } else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[index + 1] === "\n") index++;
      if (quoted) {
        lineNumber++;
        cell += "\n";
      } else {
        row.push(cell.trim());
        if (row.some(value => value !== "")) {
          rows.push(row);
          rowNumbers.push(rowStartLine);
        }
        row = [];
        cell = "";
        lineNumber++;
        rowStartLine = lineNumber;
      }
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== "")) {
    rows.push(row);
    rowNumbers.push(rowStartLine);
  }
  return { rows, rowNumbers };
}

const HEADER_HINTS: Record<string, string[]> = {
  name: ["name", "fullname", "contactname", "customername", "person"],
  firstName: ["firstname", "givenname"],
  lastName: ["lastname", "surname", "familyname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "number", "whatsapp", "whatsappnumber", "msisdn", "cell", "telephone", "contactnumber", "contact"],
  email: ["email", "emailaddress", "mail"],
  groupName: ["group", "groupname", "audience", "list", "segment"],
  tags: ["tags", "tag", "labels", "label"],
  marketingOptIn: ["marketingoptin", "optin", "consent", "subscribed"],
  optedOut: ["optedout", "optout", "unsubscribed"],
};

const HEADER_LOOKUP = new Map<string, string>();
for (const [field, hints] of Object.entries(HEADER_HINTS)) {
  for (const hint of hints) HEADER_LOOKUP.set(hint, field);
}

function normaliseHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function headerMapping(cells: string[]) {
  const mapping: Record<string, number> = {};
  cells.forEach((cell, index) => {
    const field = HEADER_LOOKUP.get(normaliseHeader(cell));
    if (field && mapping[field] === undefined) mapping[field] = index;
  });
  return mapping;
}

function looksLikePhone(value: string | undefined) {
  return (value || "").replace(/\D/g, "").length >= 7;
}

function looksLikeEmail(value: string | undefined) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((value || "").trim());
}

function detectColumn(rows: string[][], predicate: (value: string | undefined) => boolean) {
  const sample = rows.slice(0, 60);
  let best = -1;
  let bestScore = 0;
  const width = Math.max(0, ...rows.map(row => row.length));
  for (let column = 0; column < width; column++) {
    const filled = sample.filter(row => (row[column] || "").trim() !== "");
    if (filled.length === 0) continue;
    const score = filled.filter(row => predicate(row[column])).length / filled.length;
    if (score > bestScore) {
      best = column;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : -1;
}

/**
 * Reads .xlsx, .csv and .txt uploads into a table. The first row is treated as
 * a header only when it contains known column names and looks like text.
 */
export function parseSpreadsheet(buffer: Buffer, fileName: string): SpreadsheetTable {
  const lower = fileName.toLowerCase();
  let parsed: { rows: string[][]; rowNumbers: number[] };

  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const entries = readZip(buffer);
    const sharedXml = entries.get("xl/sharedStrings.xml") || "";
    const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => collectText(match[1]));
    const sheetXml = entries.get(firstSheetPath(entries));
    if (!sheetXml) throw new Error("No worksheet was found inside this workbook.");
    parsed = parseSheet(sheetXml, shared);
  } else if (lower.endsWith(".xls")) {
    throw new Error("Old .xls files are not supported. Open the file in Excel and use Save As → .xlsx or .csv, then upload again.");
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    parsed = parseDelimited(buffer.toString("utf8"));
  } else {
    throw new Error("Unsupported file type. Upload .xlsx, .xlsm, .csv, .txt or .tsv.");
  }

  if (parsed.rows.length === 0) throw new Error("This file has no rows to import.");

  const first = parsed.rows[0];
  const mapping = headerMapping(first);
  const hasHeader = Object.keys(mapping).length > 0 && !first.some(cell => looksLikePhone(cell));
  return {
    headers: hasHeader ? first : null,
    rows: hasHeader ? parsed.rows.slice(1) : parsed.rows,
    rowNumbers: hasHeader ? parsed.rowNumbers.slice(1) : parsed.rowNumbers,
    firstDataRow: hasHeader ? (parsed.rowNumbers[1] ?? (parsed.rowNumbers[0] || 1) + 1) : (parsed.rowNumbers[0] ?? 1),
  };
}

export type MappedContact = {
  name: string;
  phone: string;
  email?: string;
  groupName?: string;
  tags?: string[];
  marketingOptIn?: boolean;
  optedOut?: boolean;
  row: number;
};

const truthy = (value: string | undefined) => /^(true|yes|1|y|opted in|subscribed|consent)$/i.test((value || "").trim());

/**
 * Maps arbitrary spreadsheet rows to contacts. Missing columns fall back to
 * inference so a plain list of phone numbers (one per row) just works.
 */
export function mapRowsToContacts(
  table: SpreadsheetTable,
  defaults: { groupName?: string; marketingOptIn?: boolean } = {}
): { contacts: MappedContact[]; invalid: { row: number; value: string }[] } {
  const mapping = headerMapping(table.headers ?? []);
  const phoneColumn = mapping.phone ?? detectColumn(table.rows, looksLikePhone);
  const emailColumn = mapping.email ?? (phoneColumn === -1 ? -1 : detectColumn(table.rows, looksLikeEmail));
  const nameColumn =
    mapping.name ?? mapping.firstName ?? mapping.lastName ??
    (() => {
      const width = Math.max(0, ...table.rows.map(row => row.length));
      for (let column = 0; column < width; column++) {
        if (column === phoneColumn || column === emailColumn) continue;
        const sample = table.rows.slice(0, 40).map(row => (row[column] || "").trim()).filter(Boolean);
        if (sample.length && sample.filter(value => !looksLikePhone(value) && !looksLikeEmail(value)).length / sample.length >= 0.6) return column;
      }
      return -1;
    })();

  const contacts: MappedContact[] = [];
  const invalid: { row: number; value: string }[] = [];

  table.rows.forEach((row, index) => {
    const rawPhone = phoneColumn >= 0 ? row[phoneColumn] || "" : row.find(looksLikePhone) || "";
    if (!rawPhone.trim()) return;
    if (!looksLikePhone(rawPhone)) {
      invalid.push({ row: index + table.firstDataRow, value: rawPhone });
      return;
    }
    const name = mapping.name !== undefined
      ? (row[mapping.name] || "").trim()
      : [mapping.firstName !== undefined ? row[mapping.firstName] : "", mapping.lastName !== undefined ? row[mapping.lastName] : ""]
          .map(value => (value || "").trim())
          .filter(Boolean)
          .join(" ") || (nameColumn >= 0 ? (row[nameColumn] || "").trim() : "");
    const email = emailColumn >= 0 ? (row[emailColumn] || "").trim() : "";
    const groupName = (mapping.groupName !== undefined ? row[mapping.groupName] : "") || defaults.groupName || "";
    const tags = (mapping.tags !== undefined ? row[mapping.tags] : "")
      .split(/[|;,]/)
      .map(tag => tag.trim())
      .filter(Boolean)
      .slice(0, 20);
    contacts.push({
      name: name.slice(0, 100),
      phone: rawPhone,
      email: looksLikeEmail(email) ? email : undefined,
      groupName: groupName.trim() || undefined,
      tags,
      marketingOptIn: truthy(mapping.marketingOptIn !== undefined ? row[mapping.marketingOptIn] : ""),
      optedOut: truthy(mapping.optedOut !== undefined ? row[mapping.optedOut] : ""),
      row: table.rowNumbers[index] ?? index + table.firstDataRow,
    });
  });

  return { contacts, invalid };
}

