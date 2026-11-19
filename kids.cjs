const ts = require('typescript');
const fs = require('fs');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function line(p) { return sf.getLineAndCharacterOfPosition(p).line + 1; }
function walk(node, depth) {
  if (node.kind === ts.SyntaxKind.FunctionDeclaration && node.name && node.name.text === process.argv[3]) {
    const body = node.body;
    body.statements.forEach(s => {
      console.log(`${ts.SyntaxKind[s.kind]} lines ${line(s.getStart(sf))}-${line(s.getEnd())} :: ${s.getText(sf).split('\n')[0].slice(0, 90)}`);
    });
    return;
  }
  ts.forEachChild(node, n => walk(n, depth + 1));
}
walk(sf, 0);
