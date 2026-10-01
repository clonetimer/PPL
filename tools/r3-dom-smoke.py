#!/usr/bin/env python3
"""Offline Chromium DOM validation. No URL navigation, HTTP, CSP or module-loader E2E claim.
This loads the authored HTML/CSS/JS into about:blank with in-memory read-model fixtures.
The API-bound E2E is separately provided by r3-browser-smoke.py.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def main() -> None:
    from playwright.sync_api import sync_playwright, expect
    parser=argparse.ArgumentParser()
    parser.add_argument('--chromium-path',default=shutil.which('chromium'))
    parser.add_argument('--output',default='local-results/r3-dom')
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    public=root/'product/observatory/public'
    output=Path(args.output).resolve();output.mkdir(parents=True,exist_ok=True)
    fixture=json.loads(subprocess.check_output(['node','tools/r3-dom-fixtures.mjs'],cwd=root,env={**os.environ,'NODE_NO_WARNINGS':'1'},text=True))
    html=(public/'index.html').read_text()
    html=re.sub(r'<link rel="stylesheet"[^>]+>','',html)
    html=re.sub(r'<script type="module"[^>]+></script>','',html)
    html=html.replace('</head>','<style>'+(public/'style.css').read_text()+'</style></head>')
    module=re.sub(r'^export ', '', (public/'ui-model.mjs').read_text(),flags=re.M)
    app=re.sub(r'^import [^\n]+\n','',(public/'app.mjs').read_text(),flags=re.M)
    report={'schema':'ppl.r3-dom-smoke/1','passed':False,'mode':'offline-dom-fixture','networkEndToEnd':False,'cspBrowserEnforcementTested':False,'moduleLoadingTested':False,'checks':[]}
    def mark(name):report['checks'].append({'name':name,'passed':True})
    try:
        with sync_playwright() as p:
            options={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
            if args.chromium_path:options['executable_path']=args.chromium_path
            browser=p.chromium.launch(**options);report['browserVersion']=browser.version
            page=browser.new_page(viewport={'width':1440,'height':1050})
            errors=[];network=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda request:network.append(request.url))
            page.set_content(html)
            page.evaluate('data => { window.__fixtures = data; }',fixture)
            page.evaluate(r'''() => {
              window.__requests=[];window.__showXss=false;let ids=0;
              Object.defineProperty(crypto,'randomUUID',{value:()=>`00000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`});
              history.replaceState(null,'','#app=research&session=research-fixture-delivered&tab=overview');
              window.fetch=async (raw,options={})=>{
                const url=new URL(raw,'http://offline.fixture');
                window.__requests.push({path:url.pathname,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
                if(options.method==='POST')return new Response(JSON.stringify({error:'Offline DOM harness does not execute commands',code:'DOM_COMMAND_CAPTURED'}),{status:503});
                let value;
                if(url.pathname==='/v1/observatory/sessions'){
                  let items=window.__fixtures.list.items.filter(x=>(window.__showXss||x.sessionId!=='dom-xss')&&(!url.searchParams.get('app')||x.app===url.searchParams.get('app')));
                  const q=(url.searchParams.get('q')||'').toLowerCase();if(q)items=items.filter(x=>(x.title+' '+x.sessionId).toLowerCase().includes(q));
                  const limit=Number(url.searchParams.get('limit')||25),offset=Number(url.searchParams.get('offset')||0);
                  value={items:items.slice(offset,offset+limit),total:items.length,limit,offset,hasMore:offset+limit<items.length};
                }else{
                  value=structuredClone(window.__fixtures.routes[url.pathname]);
                  if(value?.items){
                    let items=value.items;const type=url.searchParams.get('type');if(type)items=items.filter(x=>x.type?.includes(type));
                    const limit=Number(url.searchParams.get('limit')||25),offset=Number(url.searchParams.get('offset')||0);
                    value={...value,items:items.slice(offset,offset+limit),total:items.length,limit,offset,hasMore:offset+limit<items.length};
                  }
                }
                return new Response(JSON.stringify(value??{error:'DOM fixture not found'}),{status:value?200:404});
              }
            }''')
            page.evaluate('(async()=>{\n'+module+'\n'+app+'\n})()')
            expect(page.locator('#mode-banner')).to_contain_text('FIXTURE')
            expect(page.locator('#connect-state')).to_contain_text('已连接')
            mark('fixture-mode-visible')
            expect(page.locator('#content pre.report')).to_contain_text('Study A')
            expect(page.locator('#content pre.report')).to_contain_text('Study B')
            expect(page.locator('#content pre.report')).to_contain_text('mixed')
            mark('delivered-report-preserves-support-and-oppose')
            page.screenshot(path=str(output/'01-research-overview.png'),full_page=True)
            page.locator('[data-tab="evidence"]').click()
            expect(page.locator('[data-claim]')).to_have_count(2)
            expect(page.locator('#content .badge').filter(has_text='反对')).to_be_visible()
            mark('structured-evidence-view')
            page.locator('[data-session="research-fixture-erasure"]').click()
            page.locator('[data-tab="handoffs"]').click()
            expect(page.locator('#content .finding strong').filter(has_text='COUNTER_EVIDENCE_ERASURE')).to_be_visible()
            expect(page.locator('#session-heading')).to_contain_text('分析交接被阻断')
            mark('erasure-findings-visible-and-not-masked-by-domain-status')
            page.screenshot(path=str(output/'02-fidelity-block.png'),full_page=True)
            page.locator('[data-session="research-fixture-judge-reject"]').click()
            page.locator('[data-tab="executions"]').click()
            expect(page.locator('#run-detail')).to_contain_text('Judge 已拒绝')
            expect(page.locator('#run-detail pre.report')).to_have_count(0)
            page.locator('#run-detail summary').filter(has_text='Judge 原始判定').click()
            expect(page.locator('#run-detail')).to_contain_text('"pass": false')
            mark('judge-rejection-never-rendered-as-final-answer')
            page.screenshot(path=str(output/'03-judge-rejection.png'),full_page=True)
            page.locator('[data-tab="audit"]').click()
            page.get_by_label('事件类型筛选').fill('delivery.blocked')
            page.get_by_role('button',name='筛选事件',exact=True).click()
            expect(page.locator('.timeline-item')).to_have_count(1)
            mark('audit-filter')
            page.locator('[data-app="agent"]').click()
            expect(page.locator('[data-session="agent-fixture-tools"]')).to_be_visible()
            page.locator('[data-tab="executions"]').click()
            expect(page.locator('#run-detail')).to_contain_text('工具执行')
            page.locator('#run-detail summary').filter(has_text='Host 工具结果与来源').click()
            expect(page.locator('#run-detail')).to_contain_text('"hostOwned": true')
            mark('host-tool-result-view')
            # Commands are CAPTURED, not executed. Backend behavior has separate HTTP tests.
            page.locator('[data-app="research"]').click()
            page.locator('[data-session="research-fixture-delivered"]').click()
            page.locator('[data-tab="actions"]').click()
            page.locator('#research-claim-canonicalText').fill('Manually entered evidence')
            page.locator('#research-claim-sourceRefs').fill('https://example.test/one\nhttps://example.test/two')
            page.locator('[data-form="research-claim"] button[type=submit]').click()
            expect(page.locator('#notice')).to_contain_text('DOM_COMMAND_CAPTURED')
            command=page.evaluate('window.__requests.filter(x=>x.method==="POST").at(-1)')
            assert command['body']['status']=='provisional' and len(command['body']['sourceRefs'])==2
            mark('research-manual-claim-request-uses-provisional-status-and-split-sources')
            page.locator('#create-open').click()
            page.locator('#create-question').fill('A research question')
            page.locator('[data-form="create"] button[type=submit]').click()
            expect(page.locator('#notice')).to_contain_text('DOM_COMMAND_CAPTURED')
            command=page.evaluate('window.__requests.filter(x=>x.method==="POST").at(-1)')
            assert command['path']=='/v1/research/sessions' and command['body']['question']=='A research question'
            page.locator('#create-close').click()
            mark('research-create-dialog-builds-domain-command')
            page.locator('[data-app="tutor"]').click()
            expect(page.locator('#content')).to_contain_text('学习证据')
            page.locator('[data-tab="actions"]').click()
            page.locator('#tutor-observation-hintCount').fill('2')
            page.locator('#tutor-observation-attemptCount').fill('3')
            page.locator('[data-form="tutor-observation"] button[type=submit]').click()
            expect(page.locator('#notice')).to_contain_text('DOM_COMMAND_CAPTURED')
            command=page.evaluate('window.__requests.filter(x=>x.method==="POST").at(-1)')
            assert command['body']['assessment']=={'hintCount':2,'attemptCount':3}
            assert page.locator('#tutor-verification-outcome option').evaluate_all('(nodes)=>nodes.map(x=>x.value)')==['progress','neutral','regress']
            mark('tutor-commands-use-assessment-evidence-and-valid-verifier-enum')
            page.locator('[data-app="life"]').click()
            expect(page.locator('#content')).to_contain_text('长期偏好')
            page.locator('[data-tab="actions"]').click()
            page.locator('#life-preference-value').select_option('false')
            count=page.evaluate('window.__requests.filter(x=>x.method==="POST").length')
            page.locator('[data-form="life-preference"] button[type=submit]').click()
            assert page.evaluate('window.__requests.filter(x=>x.method==="POST").length')==count
            page.locator('#life-preference-consent').check()
            page.locator('[data-form="life-preference"] button[type=submit]').click()
            expect(page.locator('#notice')).to_contain_text('DOM_COMMAND_CAPTURED')
            command=page.evaluate('window.__requests.filter(x=>x.method==="POST").at(-1)')
            assert command['body']['value'] is False and command['path'].endswith('/preferences')
            mark('life-explicit-confirmation-gates-browser-request')
            page.locator('[data-app="character"]').click()
            expect(page.locator('#content')).to_contain_text('角色关系')
            page.locator('[data-tab="actions"]').click()
            page.locator('[data-form="character-comfort"] button[type=submit]').click()
            expect(page.locator('#notice')).to_contain_text('DOM_COMMAND_CAPTURED')
            command=page.evaluate('window.__requests.filter(x=>x.method==="POST").at(-1)')
            assert command['path'].endswith('/comfort') and command['body']['eventId'].startswith('comfort_')
            mark('character-independent-event-command')
            page.locator('[data-app="research"]').click()
            page.evaluate('window.__showXss=true')
            page.locator('#refresh').click()
            page.locator('[data-session="dom-xss"]').click()
            page.locator('[data-tab="overview"]').click()
            expect(page.locator('#session-heading h2')).to_have_text(fixture['xssPayload'])
            assert page.evaluate('window.PPL_XSS') is None
            assert page.locator('#session-heading img, #session-heading script').count()==0
            assert 'dom-secret' not in page.locator('#content').text_content()
            mark('stored-html-rendered-as-inert-text-and-known-credential-redacted')
            # Same records remain readable when provider readiness is false.
            page.evaluate('''() => {
              __fixtures.routes['/v1/observatory/status'].execution.research.configured=false;
              __fixtures.routes['/v1/observatory/apps/research/sessions/research-fixture-delivered'].execution.configured=false;
            }''')
            page.locator('[data-session="research-fixture-delivered"]').click()
            page.locator('[data-tab="actions"]').click()
            expect(page.locator('[data-form="research-execute"] button[type=submit]')).to_be_disabled()
            page.locator('[data-tab="executions"]').click()
            expect(page.locator('#run-detail pre.report')).to_contain_text('mixed')
            mark('disabled-execution-does-not-disable-history-display')
            page.locator('[data-session="research-fixture-erasure"]').click()
            page.locator('[data-tab="handoffs"]').click()
            page.evaluate('window.__showXss=false')
            page.locator('#refresh').click()
            expect(page.locator('[data-session="dom-xss"]')).to_have_count(0)
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
            page.screenshot(path=str(output/'04-mobile-observatory.png'),full_page=True)
            mark('390px-mobile-layout-no-horizontal-overflow')
            assert not errors, errors
            assert not network, network
            mark('no-javascript-page-errors-and-no-browser-network-requests')
            report['pageErrors']=errors;report['browserRequests']=network;report['passed']=True
            browser.close()
    except Exception as error:
        report['error']=f'{type(error).__name__}: {error}'
        raise
    finally:
        report['checkCount']=len(report['checks'])
        (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
