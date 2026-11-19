const ts = require('typescript');
const fs = require('fs');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, src);
const stack = [];
let tok = scanner.scan();
const pairs = { [ts.SyntaxKind.OpenBraceToken]: ts.SyntaxKind.CloseBraceToken, [ts.SyntaxKind.OpenParenToken]: ts.SyntaxKind.CloseParenToken, [ts.SyntaxKind.OpenBracketToken]: ts.SyntaxKind.CloseBracketToken };
const closers = new Set([ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.CloseParenToken, ts.SyntaxKind.CloseBracketToken]);
while (tok !== ts.SyntaxKind.EndOfFileToken) {
  if (pairs[tok]) {
    const pos = scanner.getTokenPos();
    const line = src.slice(0, pos).split('\n').length;
    stack.push({ tok, line, text: src.slice(pos, scanner.getTextPos()) });
  } else if (closers.has(tok)) {
    const top = stack.pop();
    if (!top || pairs[top.tok] !== tok) {
      const pos = scanner.getTokenPos();
      const line = src.slice(0, pos).split('\n').length;
      console.log('MISMATCH closer', ts.SyntaxKind[tok], 'at line', line, 'top was', top && ts.SyntaxKind[top.tok], 'line', top && top.line);
    }
  }
  tok = scanner.scan();
}
console.log('unclosed stack:');
for (const s of stack) console.log(' ', ts.SyntaxKind[s.tok], 'line', s.line, JSON.stringify(s.text.slice(0, 60)));
