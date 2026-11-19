const ts = require('typescript');
const fs = require('fs');
const path = process.argv[2];
const text = fs.readFileSync(path, 'utf8');
const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.TSX, text);
const stack = [];
let tok = scanner.scan();
let line = 0;
const lineOf = (pos) => ts.getLineAndCharacterOfPosition(ts.createSourceFile('x', text, ts.ScriptTarget.Latest), pos).line + 1;
while (tok !== ts.SyntaxKind.EndOfFileToken) {
  if (tok === ts.SyntaxKind.OpenBraceToken) stack.push(lineOf(scanner.getTokenPos()));
  else if (tok === ts.SyntaxKind.CloseBraceToken) stack.pop();
  tok = scanner.scan();
}
console.log('unclosed open braces at lines:', stack.join(', ') || 'none');
