"""End-to-end STL interface + real local OpenSCAD jobs, not a mocked CAD engine."""
import json
import os
from pathlib import Path
import sys
import threading
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from playwright.sync_api import sync_playwright
from browser_fixture import load_app, install_http_bridge
from serve import Server

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('VMG_SCREENSHOT_DIR','artifacts'))/'stl';OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def check(name,val):
    assert val,name
    checks.append(name);print('PASS',name,flush=True)

server=None
URL=os.environ.get('VMG_TEST_URL')
if not URL:
    server=Server(('127.0.0.1',0));threading.Thread(target=server.serve_forever,daemon=True).start();URL=f'http://127.0.0.1:{server.server_port}'
BRIDGE=bool(os.environ.get('VMG_TEST_BRIDGE'))
try:
 with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('VMG_CHROMIUM') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1500,'height':1050},device_scale_factor=1)
    page.on('pageerror',lambda e:errors.append(str(e)))
    if BRIDGE:install_http_bridge(page,URL)
    load_app(page,None if BRIDGE else URL)
    page.wait_for_function('vmg.stl.engine && vmg.stl.engine.available')
    page.locator('[data-source-mode="stl"]').click()
    check('source switch shows honest empty state',page.locator('#stlPanel').is_visible() and page.locator('#exportAll').is_disabled())
    page.locator('#stlFile').set_input_files(ROOT/'examples/medallion.stl')
    page.wait_for_function('vmg.stl.mesh && vmg.model?.kind==="stl"')
    check('uploaded STL replaces the vase in real viewer',page.evaluate('vmg.model.parts.length===1 && vmg.viewer.parts[0].id==="master" && vmg.model.parts[0].bounds.size[0]===64'))
    check('master preview is not mislabeled finished tooling',not page.evaluate('vmg.ready') and page.locator('#exportAll').is_disabled())
    page.locator('#buildSTL').click()
    page.wait_for_function('vmg.ready && vmg.model.kind==="stl"',timeout=120000)
    check('hull box creates three actual printable solids',page.evaluate('vmg.model.stats.printCount===3 && vmg.model.parts.filter(p=>p.printable).every(p=>p.quality.watertight)'))
    check('silicone control is actual boolean difference',page.evaluate('vmg.model.parts.some(p=>p.type==="silicone") && vmg.model.stats.totalMl>40'))
    page.locator('#showSilicone').check()
    page.locator('[data-mode="explode"]').click()
    page.locator('[data-camera="iso"]').click()
    page.evaluate('document.querySelector(".parameters").scrollTop=0;document.querySelector(".workspace").scrollTop=0')
    page.wait_for_timeout(400);page.screenshot(path=str(OUT/'stl-box.png'),full_page=True)
    with page.expect_download() as downloaded:page.locator('#exportAll').click()
    downloaded.value.save_as(OUT/'box-kit.zip')
    check('STL kit download matches selected mode',downloaded.value.suggested_filename=='mold_box_STL.zip')
    page.locator('#stl-clearance').fill('14')
    check('editing parameters blocks old mesh export immediately',page.locator('#exportAll').is_disabled() and not page.evaluate('vmg.ready'))
    page.locator('#buildSTL').click();page.wait_for_function('vmg.ready && vmg.model.p.clearance===14',timeout=120000)
    check('regeneration changes real base bounds',page.evaluate('vmg.model.parts.find(p=>p.id==="stl-base").bounds.size[0]>100'))
    page.locator('#stlFile').set_input_files(ROOT/'examples/capsule.stl')
    page.wait_for_function('vmg.stl.name==="capsule.stl" && vmg.model.parts.length===1')
    page.locator('#stl-kind').select_option('negative')
    page.locator('#buildSTL').click();page.wait_for_function('vmg.ready && vmg.model.mode==="negative"',timeout=120000)
    check('negative uses two CSG halves with keys',page.evaluate('vmg.model.stats.printCount===2 && vmg.model.parts[0].id==="mold-a"'))
    check('unverified rigid mold requires explicit demolding acknowledgement',page.locator('#exportAll').is_disabled())
    page.locator('#stlRisk').check();check('acknowledged valid negative can export',not page.locator('#exportAll').is_disabled())
    page.locator('[data-part-id="mold-b"]').click()
    check('all imported mold parts selectable and inspectable',page.evaluate('vmg.viewer.selected==="mold-b"'))
    page.locator('[data-mode="explode"]').click();page.locator('[data-camera="iso"]').click()
    page.evaluate('document.querySelector(".parameters").scrollTop=0;document.querySelector(".workspace").scrollTop=0;vmg.viewer.select(null);document.querySelector("#toast").hidden=true')
    page.wait_for_timeout(400);page.screenshot(path=str(OUT/'stl-negative.png'),full_page=True)
    # Pick the literal top-surface point, not coordinates from a fabricated mock.
    page.locator('#pickVent').click()
    hit=page.evaluate('vmg.viewer.project([3,0,25])')
    rect=page.locator('#view3d').bounding_box();page.mouse.click(rect['x']+hit[0],rect['y']+hit[1])
    page.wait_for_function('vmg.stl.vents.length===1')
    check('clicking the actual 3D surface adds a vent',len(page.evaluate('vmg.stl.vents'))==1)
    page.locator('#buildSTL').click();page.wait_for_function('vmg.ready && vmg.model.split.channels.length===2',timeout=120000)
    check('vent becomes a real channel in regenerated negative',page.evaluate('vmg.model.split.channels[1].kind==="vent"'))
    with page.expect_download() as downloaded:page.locator('#saveProject').click()
    downloaded.value.save_as(OUT/'stl-project.json')
    raw=json.loads((OUT/'stl-project.json').read_text());check('saved STL project includes source and parameters',raw['format']=='vase-mold-generator-stl' and bool(raw['sourceSTL']))
    page.locator('#stl-scale').fill('.5');page.locator('#projectFile').set_input_files(OUT/'stl-project.json')
    page.wait_for_function('vmg.stl.options().scale===1 && vmg.stl.vents.length===1')
    check('STL project restores mesh, transformation and channels',page.evaluate('vmg.stl.name==="capsule.stl"'))
    page.locator('#stlSprueX').fill('500');page.locator('#stlSprueY').fill('500');page.locator('#buildSTL').click()
    page.wait_for_function('!vmg.stl.job && document.querySelector("#stlMessage").classList.contains("error")',timeout=120000)
    check('channel missing the source is rejected, not silently ignored',page.locator('#exportAll').is_disabled() and 'не попадает' in page.locator('#stlMessage').inner_text())
    page.locator('#autoSprue').click();page.locator('#buildSTL').click()
    page.wait_for_function('vmg.stl.job!==null',timeout=20000);page.locator('#cancelSTL').click()
    check('cancel blocks output and returns editing state',not page.evaluate('vmg.ready') and page.locator('#exportAll').is_disabled())
    page.wait_for_timeout(400)
    page.locator('[data-source-mode="vase"]').click();page.wait_for_function('vmg.ready && !vmg.model.kind')
    check('cylinder mode still works after cancelling CSG',page.evaluate('vmg.model.stats.printCount===10'))
    mobile=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,reduced_motion='reduce')
    mobile.on('pageerror',lambda e:errors.append(str(e)))
    if BRIDGE:install_http_bridge(mobile,URL)
    load_app(mobile,None if BRIDGE else URL)
    mobile.locator('[data-source-mode="stl"]').click();mobile.locator('#stlFile').set_input_files(ROOT/'examples/medallion.stl')
    mobile.wait_for_function('vmg.stl.mesh!==null');mobile.locator('#stl-kind').select_option('negative')
    check('mobile STL tools do not overflow',mobile.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    mobile.screenshot(path=str(OUT/'stl-mobile.png'),full_page=True)
    check('no uncaught exceptions',not errors)
    report={'passed':len(checks),'checks':checks,'backend':page.evaluate('vmg.viewer.backend'),'transport':'Blob modules + real HTTP bridge' if BRIDGE else 'HTTP','errors':errors}
    (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False),flush=True)
    browser.close()
finally:
 if server:server.shutdown();server.server_close()
