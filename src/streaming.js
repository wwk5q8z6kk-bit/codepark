export function parseSseLines(text) {
  return text
    .split(/\n\n+/)
    .map(block => block.split('\n').find(line => line.startsWith('data: ')))
    .filter(Boolean)
    .map(line => line.slice('data: '.length).trim());
}
