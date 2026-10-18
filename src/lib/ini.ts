// Minimal INI reader/writer for Assetto Corsa config files.
// Edits change only the lines they touch: comments, ordering, unknown keys and the file's line
// endings (AC files usually come from Windows with CRLF) are kept as they were.

type Line =
  | { kind: "section"; name: string; raw: string }
  | { kind: "pair"; section: string; key: string; value: string; raw: string }
  | { kind: "other"; raw: string };

export class IniFile {
  private lines: Line[];
  private eol: string;

  constructor(text: string) {
    this.eol = text.includes("\r\n") ? "\r\n" : "\n";
    let section = "";
    this.lines = text.replace(/^﻿/, "").split(/\r?\n/).map((raw): Line => {
      const trimmed = raw.trim();
      const header = /^\[([^\]]+)\]/.exec(trimmed);
      if (header) {
        section = header[1].trim().toUpperCase();
        return { kind: "section", name: section, raw };
      }
      const eq = trimmed.indexOf("=");
      if (eq > 0 && !trimmed.startsWith(";") && !trimmed.startsWith("#")) {
        return { kind: "pair", section, key: trimmed.slice(0, eq).trim().toUpperCase(), value: trimmed.slice(eq + 1).trim(), raw };
      }
      return { kind: "other", raw };
    });
    // Drop the empty "line" after a trailing newline; toString() adds it back.
    if (this.lines.length && this.lines.at(-1)!.raw === "") this.lines.pop();
  }

  get(section: string, key: string): string | undefined {
    const s = section.toUpperCase(), k = key.toUpperCase();
    const line = this.lines.find((l) => l.kind === "pair" && l.section === s && l.key === k);
    return line?.kind === "pair" ? line.value : undefined;
  }

  sections(): string[] {
    return this.lines.flatMap((l) => (l.kind === "section" ? [l.name] : []));
  }

  set(section: string, key: string, value: string) {
    if (/[\r\n]/.test(value)) throw new Error(`${key}: value can't contain line breaks`);
    const s = section.toUpperCase(), k = key.toUpperCase();
    const existing = this.lines.find((l) => l.kind === "pair" && l.section === s && l.key === k);
    if (existing?.kind === "pair") {
      existing.value = value;
      existing.raw = `${k}=${value}`;
      return;
    }
    let insertAt = -1;
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i];
      if (l.kind === "section" && l.name === s) insertAt = i + 1;
      else if (insertAt >= 0 && l.kind === "pair" && l.section === s) insertAt = i + 1;
    }
    const pair: Line = { kind: "pair", section: s, key: k, value, raw: `${k}=${value}` };
    if (insertAt >= 0) this.lines.splice(insertAt, 0, pair);
    else this.lines.push({ kind: "section", name: s, raw: `[${s}]` }, pair);
  }

  toString() {
    return this.lines.map((l) => l.raw).join(this.eol) + this.eol;
  }
}
