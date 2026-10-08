from pathlib import Path
import subprocess

# Reuse the already-reviewed patch body from the parent commit, then tighten
# the successful-run result so a caught playback error cannot be mislabeled.
previous = subprocess.check_output(
    ['git', 'show', 'HEAD^:scripts/apply-director-971.py'],
    text=True,
)
exec(compile(previous, 'scripts/apply-director-971.py@HEAD^', 'exec'), globals())

path = Path('src/scenes/director.js')
text = path.read_text()

start = """    this._setPlaybackKeyboardEnabled(true);

    try {
"""
replacement = """    this._setPlaybackKeyboardEnabled(true);

    let runResult = { started: true, shots: queue.length };
    try {
"""
if text.count(start) != 1:
    raise SystemExit('run-result start anchor missing')
text = text.replace(start, replacement, 1)

catch = """    } catch (error) {
      this._updateStatus(`Error: ${error.message || 'run failed'}`);
      this._logEvent('scene_run_error', {
        message: error.message || 'unknown error',
      });
    } finally {
"""
replacement = """    } catch (error) {
      this._updateStatus(`Error: ${error.message || 'run failed'}`);
      this._logEvent('scene_run_error', {
        message: error.message || 'unknown error',
      });
      runResult = { started: false, reason: 'run-failed' };
    } finally {
"""
if text.count(catch) != 1:
    raise SystemExit('run-result catch anchor missing')
text = text.replace(catch, replacement, 1)

success = '    return { started: true, shots: queue.length };\n'
if text.count(success) != 1:
    raise SystemExit('run-result return anchor missing')
text = text.replace(success, '    return runResult;\n', 1)
path.write_text(text)
