#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const [configPath = "wrangler.toml", binding = "DB", migrationsDir = "drizzle"] =
  process.argv.slice(2);

const source = readFileSync(configPath, "utf8");
const lines = source.split("\n");
const blockStarts = [];

for (let index = 0; index < lines.length; index += 1) {
  if (/^\s*\[\[d1_databases\]\]\s*$/.test(lines[index])) {
    blockStarts.push(index);
  }
}

let targetBlock = null;

for (let blockIndex = 0; blockIndex < blockStarts.length; blockIndex += 1) {
  const start = blockStarts[blockIndex];
  const end = blockStarts[blockIndex + 1] ?? lines.length;
  const block = lines.slice(start, end);
  const bindingLine = block.find((line) => /^\s*binding\s*=/.test(line));
  const bindingMatch = bindingLine?.match(/^\s*binding\s*=\s*"([^"]+)"/);

  if (bindingMatch?.[1] === binding) {
    targetBlock = { start, end };
    break;
  }
}

if (!targetBlock) {
  throw new Error(`Could not find [[d1_databases]] block with binding "${binding}" in ${configPath}`);
}

const blockLines = lines.slice(targetBlock.start, targetBlock.end);
const migrationsLineIndex = blockLines.findIndex((line) => /^\s*migrations_dir\s*=/.test(line));
const migrationsLine = `migrations_dir = "${migrationsDir}"`;

if (migrationsLineIndex >= 0) {
  lines[targetBlock.start + migrationsLineIndex] = migrationsLine;
} else {
  const databaseIdLineIndex = blockLines.findIndex((line) => /^\s*database_id\s*=/.test(line));
  const insertAt =
    databaseIdLineIndex >= 0
      ? targetBlock.start + databaseIdLineIndex + 1
      : targetBlock.end;
  lines.splice(insertAt, 0, migrationsLine);
}

writeFileSync(configPath, lines.join("\n"));
