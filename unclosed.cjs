const ts = require('typescript');
const fs = require('fs');
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n').length;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const bad = [];
  function walk(node) {
    const isFn = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isClassDeclaration(node) || ts.isModuleDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isBlock(node);
    if (isFn) {
      const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      if (end >= lines - 1) {
        const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        bad.push(`${ts.SyntaxKind[node.kind]} ${start}-${end} ${node.name ? node.name.getText(sf) : ''}`);
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(sf);
  console.log(file, 'lines=' + lines);
  bad.slice(0, 8).forEach(b => console.log('  unclosed:', b));
}
