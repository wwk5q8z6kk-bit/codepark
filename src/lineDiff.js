export function createLineDiff(before, after) {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  if (oldLines.length * newLines.length > 2_000_000) {
    return diffWithEdges(oldLines, newLines);
  }
  return diffWithLcs(oldLines, newLines);
}

function splitLines(value) {
  const lines = String(value ?? '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function diffWithLcs(oldLines, newLines) {
  const width = newLines.length + 1;
  const table = new Uint32Array((oldLines.length + 1) * width);
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const position = oldIndex * width + newIndex;
      table[position] = oldLines[oldIndex] === newLines[newIndex]
        ? table[(oldIndex + 1) * width + newIndex + 1] + 1
        : Math.max(table[(oldIndex + 1) * width + newIndex], table[oldIndex * width + newIndex + 1]);
    }
  }

  const rows = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      rows.push({ type: 'same', line: oldLines[oldIndex] });
      oldIndex += 1;
      newIndex += 1;
    } else if (newIndex < newLines.length && (oldIndex === oldLines.length || table[oldIndex * width + newIndex + 1] >= table[(oldIndex + 1) * width + newIndex])) {
      rows.push({ type: 'new', line: newLines[newIndex] });
      newIndex += 1;
    } else {
      rows.push({ type: 'old', line: oldLines[oldIndex] });
      oldIndex += 1;
    }
  }
  return rows;
}

function diffWithEdges(oldLines, newLines) {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;
  return [
    ...oldLines.slice(0, prefix).map(line => ({ type: 'same', line })),
    ...oldLines.slice(prefix, oldLines.length - suffix).map(line => ({ type: 'old', line })),
    ...newLines.slice(prefix, newLines.length - suffix).map(line => ({ type: 'new', line })),
    ...oldLines.slice(oldLines.length - suffix).map(line => ({ type: 'same', line }))
  ];
}
