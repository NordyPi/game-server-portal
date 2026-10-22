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

  hasSection(section: string) {
    const s = section.toUpperCase();
    return this.lines.some((l) => l.kind === "section" && l.name === s);
  }

  /**
   * Removes a section and its keys. Blank lines and comments right before the next section stay
   * (they belong to that one), and the gap left behind is closed up to a single blank line.
   */
  removeSection(section: string) {
    const s = section.toUpperCase();
    const start = this.lines.findIndex((l) => l.kind === "section" && l.name === s);
    if (start < 0) return;
    let end = this.lines.findIndex((l, i) => i > start && l.kind === "section");
    if (end < 0) end = this.lines.length;
    while (end > start + 1 && this.lines[end - 1].kind === "other" && end < this.lines.length) end--;
    this.lines.splice(start, end - start);
    // Collapse the blank lines that now meet where the section was.
    const at = start;
    while (at > 0 && at < this.lines.length && isBlank(this.lines[at - 1]) && isBlank(this.lines[at])) {
      this.lines.splice(at, 1);
    }
    while (this.lines.length && isBlank(this.lines.at(-1)!)) this.lines.pop();
  }

  /**
   * Adds a new section with these keys, placed before the first of `before` that exists (or, failing
   * that, after the last of `after` that exists; otherwise at the end), with blank lines around it.
   */
  addSection(section: string, pairs: [string, string][], place: { before?: string[]; after?: string[] } = {}) {
    const s = section.toUpperCase();
    if (this.hasSection(s)) throw new Error(`[${s}] already exists`);
    for (const [k, v] of pairs) if (/[\r\n]/.test(v)) throw new Error(`${k}: value can't contain line breaks`);
    const header = (name: string) => this.lines.findIndex((l) => l.kind === "section" && l.name === name.toUpperCase());
    const sectionEnd = (start: number) => {
      let end = this.lines.findIndex((l, i) => i > start && l.kind === "section");
      if (end < 0) end = this.lines.length;
      while (end > start + 1 && isBlank(this.lines[end - 1])) end--;
      return end;
    };

    let at = this.lines.length;
    const nextIndex = (place.before ?? []).map(header).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    const prevIndex = (place.after ?? []).map(header).filter((i) => i >= 0).sort((a, b) => b - a)[0];
    if (nextIndex !== undefined) at = nextIndex;
    else if (prevIndex !== undefined) at = sectionEnd(prevIndex);

    const block: Line[] = [
      { kind: "section", name: s, raw: `[${s}]` },
      ...pairs.map(([k, v]): Line => ({ kind: "pair", section: s, key: k.toUpperCase(), value: v, raw: `${k.toUpperCase()}=${v}` })),
    ];
    if (at > 0 && !isBlank(this.lines[at - 1])) block.unshift({ kind: "other", raw: "" });
    if (at < this.lines.length && !isBlank(this.lines[at])) block.push({ kind: "other", raw: "" });
    this.lines.splice(at, 0, ...block);
  }

  toString() {
    return this.lines.map((l) => l.raw).join(this.eol) + this.eol;
  }
}

function isBlank(line: Line) {
  return line.kind === "other" && line.raw.trim() === "";
}
