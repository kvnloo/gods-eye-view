from pathlib import Path

scope = Path('scripts/format-scope.json')
text = scope.read_text()
entry = '  "src/director/callbackHardening.test.mjs",\n'
if entry not in text:
    anchor = '  "src/data/inputOwnership.test.mjs",\n'
    if anchor not in text:
        raise SystemExit('format-scope anchor missing')
    text = text.replace(anchor, anchor + entry, 1)
    scope.write_text(text)
