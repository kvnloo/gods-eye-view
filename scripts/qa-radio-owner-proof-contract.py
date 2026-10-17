"""Chromium contract smoke checks on the exact #250 proposed state projector.
Synthetic DOM ONLY: not a GEV live-app acceptance test.
"""
from pathlib import Path
import re, json
from playwright.sync_api import sync_playwright

script = Path(__file__).with_name('qa-radio-owner-visual.mjs').read_text()
start = script.index('  page.evaluate(() => {') + len('  page.evaluate(')
end = script.index('\n  });', start) + len('\n  }')
source_projector = script[start:end] # arrow function, evaluated as IIFE
js_projector = '(' + source_projector + ')()'

html = '''<!doctype html><style>
#global-context-panel {display:block;width:220px;height:160px;}
#context-radio-mini {display:block;width:180px;height:40px;}
#context-radio-mini[hidden]{display:none}
</style><section id="global-context-panel" class="collapsed layout-auto-collapsed">
<div id="context-radio-dock"><button id="context-radio-toggle-btn" aria-expanded="false" aria-controls="context-radio-mini">Radio</button>
<div id="context-radio-mini" hidden>Radio mini</div></div></section>'''


def assert_contract(pre, disclosed, restored, expected):
    assert pre['compactOpen'] is False
    assert pre['miniHidden'] is True
    assert pre['expanded'] == 'false'
    assert pre['radioControls'] == 'context-radio-mini'
    assert disclosed['compactOpen'] is True
    assert disclosed['miniHidden'] is False
    assert disclosed['miniRendered'] is True
    assert disclosed['expanded'] == 'true'
    assert disclosed['radioControls'] == 'context-radio-mini'
    assert restored['collapsed'] is False
    assert restored['contextRendered'] is True
    assert restored['radioControls'] == 'radio-panel'
    assert restored['compactOpen'] == (expected == 'buggy')
    assert restored['miniHidden'] == (expected == 'fixed')
    assert restored['miniRendered'] == (expected == 'buggy')


def apply_stage(page, stage, fault=None):
    page.evaluate('''([stage, fault]) => {
      const panel=document.getElementById('global-context-panel');
      const dock=document.getElementById('context-radio-dock');
      const mini=document.getElementById('context-radio-mini');
      const btn=document.getElementById('context-radio-toggle-btn');
      if (stage==='disclosed') {
        dock.classList.add('disclosure-open'); mini.hidden=false;
        btn.setAttribute('aria-expanded', 'true');
      }
      if (stage==='baseline' || stage==='buggy' || stage==='fixed') {
        panel.classList.remove('collapsed','layout-auto-collapsed');
        btn.setAttribute('aria-controls','radio-panel');
        if(stage==='fixed'){dock.classList.remove('disclosure-open');mini.hidden=true;}
      }
      if (fault==='no-real-click') btn.setAttribute('aria-expanded','false');
      if (fault==='wrong-launcher') btn.setAttribute('aria-controls','radio-panel');
      if (fault==='orphaned-owner') dock.classList.add('disclosure-open');
      if (fault==='css-hidden') mini.style.display='none';
    }''', [stage, fault])

results={}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for name,expected,fault_stage,fault in [
        ('baseline-valid','buggy',None,None),
        ('candidate-valid','fixed',None,None),
        ('failed-disclosure-click','buggy','disclosed','no-real-click'),
        ('wrong-aria-controls','buggy','disclosed','wrong-launcher'),
        ('candidate-orphaned-owner','fixed','fixed','orphaned-owner'),
        ('css-hidden-baseline','buggy','buggy','css-hidden'),
    ]:
        page=browser.new_page(viewport={'width':1440,'height':900})
        page.set_content(html)
        pre=page.evaluate(js_projector)
        apply_stage(page,'disclosed', fault if fault_stage=='disclosed' else None)
        disclosed=page.evaluate(js_projector)
        apply_stage(page,expected, fault if fault_stage==expected else None)
        restored=page.evaluate(js_projector)
        try:
            assert_contract(pre,disclosed,restored,expected)
            outcome='PASS'
        except AssertionError:
            outcome='REJECT'
        should_accept=fault is None
        assert (outcome=='PASS')==should_accept,(name,outcome)
        results[name]=outcome
        page.close()
    browser.close()
Path(__file__).with_name('synthetic-browser-contract.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
