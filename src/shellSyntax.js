const operators = ['&&', '||', '>>', '<<', '|', ';', '<', '>'];

export function parseShellWords(value) {
  const text = String(value ?? '');
  const tokens = [];
  let word = '';
  let quote = '';

  const pushWord = () => {
    if (word) tokens.push(word);
    word = '';
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) {
        quote = '';
      } else if (character === '\\' && quote === '"' && index + 1 < text.length) {
        word += text[index + 1];
        index += 1;
      } else {
        word += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '\\' && index + 1 < text.length) {
      word += text[index + 1];
      index += 1;
      continue;
    }
    if (/\s/.test(character)) {
      pushWord();
      continue;
    }
    const operator = operators.find(item => text.startsWith(item, index));
    if (operator) {
      pushWord();
      tokens.push({ op: operator });
      index += operator.length - 1;
      continue;
    }
    word += character;
  }
  pushWord();
  return tokens;
}

export function quoteShellWords(values) {
  return values.map(value => quoteShellWord(value)).join(' ');
}

export function quoteShellWord(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:=+,-]+$/.test(text)) return text;
  return `'${text.split("'").join("'\"'\"'")}'`;
}
