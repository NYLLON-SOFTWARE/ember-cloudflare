const ts = require('typescript');
const fs = require('fs');
const path = process.argv[2];
const text = fs.readFileSync(path, 'utf8');
const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.LanguageVariant.TSX);
const lineOf = (pos) => ts.getLineAndCharacterOfPosition(sf, pos).line + 1;
for (const s of sf.statements) {
  if (s.kind === ts.SyntaxKind.ExpressionStatement && text.slice(s.getStart(sf), s.getStart(sf)+9) === 'describe(') {
    const start = lineOf(s.getStart(sf));
    console.log(`describe at ${start}, ends at ${lineOf(s.end)}, arg end line ${lineOf(s.arguments?.[0]?.end ?? s.end)}`);
    // if it's the Edit your profile describe, list its statements' end lines
    if (start === 124) {
      const cb = s.expression.arguments[1];
      const body = cb.body;
      for (const st of body.statements) {
        const txt = text.slice(st.getStart(sf), st.getStart(sf)+50).replace(/\n/g,' ');
        console.log(`   stmt ends ${lineOf(st.end)}: ${txt}`);
      }
    }
  }
}
