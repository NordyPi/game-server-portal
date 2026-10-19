import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// AssettoServer refuses to start in two situations that are normal for us:
//   - a car has no data.acd on the server (cars added by hand only exist on players' PCs)
//   - a mod track isn't in its downloaded list of track coordinates/time zones
// Both can be switched off in cfg/extra_cfg.yml. Cars that do have data.acd still get their
// anti-cheat checksum. https://assettoserver.org/docs/common-configuration-errors
//
// We only ever touch these two lines. Everything else in extra_cfg.yml is left as it is.

const FLAGS = ["MissingCarChecksums", "MissingTrackParams"] as const;
const BLOCK = "IgnoreConfigurationErrors";

export function allowMissingContent(yaml: string): string {
  const eol = yaml.includes("\r\n") ? "\r\n" : "\n";
  const lines = yaml.split(/\r?\n/);
  // Plugin settings follow the server's own settings, each starting with "---" and/or a
  // "!PluginConfiguration" line. Only ever look at / write to the server's part before that.
  let mainEnd = lines.findIndex((l, i) => (l.trimEnd() === "---" && i > 0) || l.startsWith("!"));
  if (mainEnd < 0) mainEnd = lines.length;
  const start = lines.findIndex((l, i) => i < mainEnd && new RegExp(`^${BLOCK}:\\s*(\\{\\s*\\})?\\s*(#.*)?$`).test(l));

  if (start < 0) {
    // Insert at the end of the server's part, before any blank lines that separate it from plugins.
    let at = mainEnd;
    while (at > 0 && lines[at - 1] === "") at--;
    const block = [`${BLOCK}:`, ...FLAGS.map((f) => `  ${f}: true`)];
    if (at === lines.length) block.push("");
    lines.splice(at, 0, ...block);
    return lines.join(eol);
  }

  lines[start] = `${BLOCK}:`;
  // The block runs until the next line that isn't indented (blank lines and comments don't end it).
  let end = start + 1;
  while (end < mainEnd && (/^\s/.test(lines[end]) || lines[end] === "" || lines[end].startsWith("#"))) end++;
  const indent = lines.slice(start + 1, end).find((l) => /^\s+\S/.test(l))?.match(/^\s+/)?.[0] ?? "  ";

  for (const flag of FLAGS) {
    const i = lines.findIndex((l, n) => n > start && n < end && new RegExp(`^\\s+${flag}\\s*:`).test(l));
    if (i >= 0) lines[i] = lines[i].replace(new RegExp(`(${flag}\\s*:\\s*)[^#]*?(\\s*(#.*)?)$`), "$1true$2");
    else {
      lines.splice(start + 1, 0, `${indent}${flag}: true`);
      end++;
    }
  }
  return lines.join(eol);
}

/** Creates cfg/extra_cfg.yml if needed; AssettoServer fills in defaults for everything else. */
export async function ensureMissingContentAllowed(serverDir: string): Promise<boolean> {
  const file = path.join(serverDir, "cfg", "extra_cfg.yml");
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch {
    // not created yet: AssettoServer only writes it on first start
  }
  const updated = allowMissingContent(current);
  if (updated === current) return false;
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, updated, "utf8");
  await rename(tmp, file);
  return true;
}
