import { createLineDiff } from './lineDiff.js';

export function createUnifiedDiff(filePath, before, after) {
  const lines = [`--- ${filePath} before`, `+++ ${filePath} after`];

  if (before === after) {
    return `${lines.join('\n')}\n@@\n[no changes]\n`;
  }

  const rows = createLineDiff(before, after);
  for (const hunk of createHunks(rows, 3)) {
    lines.push(formatHunkHeader(rows, hunk));
    for (const row of rows.slice(hunk.start, hunk.end + 1)) {
      lines.push(`${prefixForType(row.type)}${row.line}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function createHunks(rows, contextLines) {
  const hunks = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].type === 'same') continue;
    const start = Math.max(0, index - contextLines);
    const end = Math.min(rows.length - 1, findChangeEnd(rows, index) + contextLines);
    const previous = hunks[hunks.length - 1];
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      hunks.push({ start, end });
    }
    index = end;
  }
  return hunks;
}

function findChangeEnd(rows, start) {
  let end = start;
  for (let index = start + 1; index < rows.length; index += 1) {
    if (rows[index].type === 'same') break;
    end = index;
  }
  return end;
}

function formatHunkHeader(rows, hunk) {
  const beforeRows = rows.slice(0, hunk.start);
  const hunkRows = rows.slice(hunk.start, hunk.end + 1);
  const oldStart = countRows(beforeRows, row => row.type !== 'new') + 1;
  const newStart = countRows(beforeRows, row => row.type !== 'old') + 1;
  const oldCount = countRows(hunkRows, row => row.type !== 'new');
  const newCount = countRows(hunkRows, row => row.type !== 'old');
  return `@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`;
}

function countRows(rows, predicate) {
  return rows.reduce((count, row) => count + (predicate(row) ? 1 : 0), 0);
}

function formatRange(start, count) {
  if (count === 0) return `${Math.max(0, start - 1)},0`;
  if (count === 1) return String(start);
  return `${start},${count}`;
}

function prefixForType(type) {
  if (type === 'old') return '-';
  if (type === 'new') return '+';
  return ' ';
}
