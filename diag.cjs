const ts = require('typescript');
const fs = require('fs');
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const diags = sf.parseDiagnostics || [];
  console.log('==', file, diags.length, 'diags');
  for (const d of diags.slice(0, 6)) {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start);
    console.log(`  line ${line + 1}:${character + 1}`, ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 100));
  }
}
