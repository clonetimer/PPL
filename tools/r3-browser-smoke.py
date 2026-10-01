#!/usr/bin/env python3
"""Optional real-Chromium E2E. Product install itself has no Python/browser dependency.
Run from the project root:
    python tools/r3-browser-smoke.py --chromium-path /usr/bin/chromium --output local-results/r3-browser
Uses a temporary fixture database and leaves normal product data untouched.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--chromium-path', default=shutil.which('chromium') or shutil.which('chromium-browser'))
    parser.add_argument('--output', default='local-results/r3-browser')
    args = parser.parse_args()
    try:
        from playwright.sync_api import sync_playwright, expect
    except ImportError as error:
        raise SystemExit('Optional E2E dependency missing: install Python playwright and a compatible Chromium browser.') from error
    root = Path(__file__).resolve().parents[1]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    checks: list[dict] = []
    def passed(name: str) -> None:
        checks.append({'name': name, 'passed': True})
    report = {'schema': 'ppl.r3-browser-smoke/1', 'passed': False, 'mode': 'fixture', 'externalLiveQualified': False, 'productVersion': json.loads((root / 'package.json').read_text())['version'], 'checks': checks}
    with tempfile.TemporaryDirectory(prefix='ppl-browser-r3-') as tmp:
        env = {**os.environ, 'PPL_DEMO_PORT': '0', 'PPL_DEMO_DB': str(Path(tmp) / 'browser.sqlite'), 'NODE_NO_WARNINGS': '1'}
        server_log = output / 'demo-server.log'
        with server_log.open('w', encoding='utf8') as log:
            process = subprocess.Popen(['node', 'tools/r3-demo-server.mjs'], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                base = None
                for _ in range(200):
                    if process.poll() is not None:
                        raise RuntimeError('Demo server failed: ' + server_log.read_text())
                    for line in server_log.read_text(encoding='utf8').splitlines():
                        try:
                            data = json.loads(line)
                            if data.get('schema') == 'ppl.observatory-demo-ready/1':
                                base = data['url'].rstrip('/')
                        except json.JSONDecodeError:
                            pass
                    if base:
                        break
                    time.sleep(.05)
                if not base:
                    raise RuntimeError('Demo readiness was not received.')
                with sync_playwright() as pw:
                    launch = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage']}
                    if args.chromium_path:
                        launch['executable_path'] = args.chromium_path
                    browser = pw.chromium.launch(**launch)
                    report['browserVersion'] = browser.version
                    context = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
                    page = context.new_page()
                    errors: list[str] = []
                    remote_requests: list[str] = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.on('request', lambda request: remote_requests.append(request.url) if not request.url.startswith(base) and not request.url.startswith('blob:') else None)
                    page.goto(base, wait_until='networkidle')
                    expect(page.locator('#mode-banner')).to_contain_text('FIXTURE')
                    expect(page.locator('#connect-state')).to_contain_text('已连接')
                    passed('fixture-mode-explicit-and-service-connected')
                    for app in ['research', 'agent', 'tutor', 'life', 'character']:
                        expect(page.locator(f'[data-app="{app}"]')).to_be_visible()
                    passed('five-independent-application-navigation-entries')
                    page.locator('[data-session="research-fixture-delivered"]').click()
                    expect(page.locator('#content pre.report')).to_contain_text('Study A')
                    expect(page.locator('#content pre.report')).to_contain_text('Study B')
                    expect(page.locator('#content pre.report')).to_contain_text('mixed')
                    passed('delivered-report-renders-both-polarities')
                    page.screenshot(path=str(output / '01-research-overview.png'), full_page=True)
                    page.locator('[data-tab="evidence"]').click()
                    expect(page.locator('[data-claim]')).to_have_count(2)
                    expect(page.locator('#content .badge').filter(has_text='反对')).to_be_visible()
                    passed('canonical-evidence-and-source-visibility')
                    page.locator('[data-session="research-fixture-erasure"]').click()
                    page.locator('[data-tab="handoffs"]').click()
                    expect(page.locator('#content .finding strong').filter(has_text='COUNTER_EVIDENCE_ERASURE')).to_be_visible()
                    expect(page.locator('#session-heading')).to_contain_text('分析交接被阻断')
                    passed('counter-evidence-erasure-is-visible-not-hidden-by-session-status')
                    page.screenshot(path=str(output / '02-fidelity-block.png'), full_page=True)
                    page.locator('[data-session="research-fixture-judge-reject"]').click()
                    page.locator('[data-tab="executions"]').click()
                    expect(page.locator('#run-detail')).to_contain_text('Judge 已拒绝')
                    expect(page.locator('#run-detail pre.report')).to_have_count(0)
                    page.locator('#run-detail summary').filter(has_text='Judge 原始判定').click()
                    expect(page.locator('#run-detail')).to_contain_text('"pass": false')
                    passed('judge-rejected-candidate-not-rendered-as-final-delivery')
                    page.screenshot(path=str(output / '03-judge-rejection.png'), full_page=True)
                    page.locator('[data-tab="audit"]').click()
                    expect(page.locator('.timeline-item')).not_to_have_count(0)
                    page.get_by_label('事件类型筛选').fill('delivery.blocked')
                    page.get_by_role('button', name='筛选事件', exact=True).click()
                    expect(page.locator('.timeline-item')).to_have_count(1)
                    passed('audit-timeline-type-filter')
                    page.locator('[data-app="agent"]').click()
                    expect(page.locator('[data-session="agent-fixture-tools"]')).to_be_visible()
                    page.locator('[data-tab="executions"]').click()
                    expect(page.locator('#run-detail')).to_contain_text('工具执行')
                    page.locator('#run-detail summary').filter(has_text='Host 工具结果与来源').click()
                    expect(page.locator('#run-detail')).to_contain_text('"hostOwned": true')
                    passed('host-owned-tool-call-is-visible')
                    # Research create -> command -> execution read, using the real UI event handlers.
                    page.locator('[data-app="research"]').click()
                    page.locator('#create-open').click()
                    page.locator('#create-sessionId').fill('browser-research')
                    page.locator('#create-question').fill('[Fixture] Browser research workflow')
                    page.locator('[data-form="create"] button[type=submit]').click()
                    expect(page.locator('#create-dialog')).not_to_be_visible()
                    expect(page.locator('#session-heading')).to_contain_text('browser-research')
                    page.locator('[data-tab="actions"]').click()
                    page.locator('[data-form="research-execute"] button[type=submit]').click()
                    expect(page.locator('#notice')).to_contain_text('已交付')
                    passed('research-create-and-execute-through-browser')
                    # Hand-entered sources stay provisional and are separate references.
                    page.locator('#research-claim-canonicalText').fill('Browser-entered provisional evidence')
                    page.locator('#research-claim-sourceRefs').fill('https://example.test/one\nhttps://example.test/two')
                    page.locator('[data-form="research-claim"] button[type=submit]').click()
                    expect(page.locator('#notice')).to_contain_text('操作已记录')
                    evidence = context.request.get(base + '/v1/research/sessions/browser-research/evidence').json()['evidence']
                    added = next(c for c in evidence if c['canonicalText'] == 'Browser-entered provisional evidence')
                    assert added['status'] == 'provisional' and len(added['sourceRefs']) == 2
                    passed('manual-evidence-does-not-promote-status-and-keeps-line-separated-sources')
                    # Independent Tutor actions change the state evidence, not just a UI toast.
                    page.locator('[data-app="tutor"]').click()
                    expect(page.locator('[data-session="tutor-fixture"]')).to_be_visible()
                    old = context.request.get(base + '/v1/tutor/sessions/tutor-fixture/summary').json()
                    page.locator('[data-tab="actions"]').click()
                    page.locator('#tutor-observation-hintCount').fill('0')
                    page.locator('#tutor-observation-attemptCount').fill('1')
                    page.locator('[data-form="tutor-observation"] button[type=submit]').click()
                    expect(page.locator('#notice')).to_contain_text('操作已记录')
                    new = context.request.get(base + '/v1/tutor/sessions/tutor-fixture/summary').json()
                    assert new['model']['observations'] == old['model']['observations'] + 1
                    assert new['model']['directAssessments'] == old['model']['directAssessments'] + 1
                    passed('tutor-observation-updates-real-independent-learner-state')
                    page.locator('#tutor-intervention-interventionId').fill('browser-intervention')
                    page.locator('[data-form="tutor-intervention"] button[type=submit]').click()
                    expect(page.locator('#notice')).to_contain_text('操作已记录')
                    page.locator('#tutor-verification-interventionId').fill('browser-intervention')
                    page.locator('#tutor-verification-outcome').select_option('regress')
                    page.locator('[data-form="tutor-verification"] button[type=submit]').click()
                    expect(page.locator('#notice')).to_contain_text('操作已记录')
                    verified = context.request.get(base + '/v1/tutor/sessions/tutor-fixture/summary').json()
                    assert verified['verifier']['last']['outcome'] == 'regress'
                    passed('tutor-verifier-uses-stable-enum-not-display-labels')
                    page.locator('[data-app="life"]').click()
                    expect(page.locator('[data-session="life-fixture"]')).to_be_visible()
                    page.locator('[data-tab="actions"]').click()
                    page.locator('#life-preference-value').select_option('false')
                    assert not page.locator('#life-preference-consent').is_checked()
                    page.locator('[data-form="life-preference"] button[type=submit]').click()
                    before_consent = context.request.get(base + '/v1/life/sessions/life-fixture').json()
                    assert before_consent['state']['preferences']['quietPlaces'] is True
                    page.locator('#life-preference-consent').check()
                    page.locator('[data-form="life-preference"] button[type=submit]').click()
                    expect(page.locator('#notice')).to_contain_text('操作已记录')
                    after_consent = context.request.get(base + '/v1/life/sessions/life-fixture').json()
                    assert after_consent['state']['preferences']['quietPlaces'] is False
                    passed('life-long-term-mutation-requires-visible-explicit-confirmation')
                    page.locator('#life-realtime-locator').fill('browser:weather:now')
                    page.locator('[data-form="life-realtime"] button[type=submit]').click()
                    expect(page.locator('#notice')).to_contain_text('操作已记录')
                    life = context.request.get(base + '/v1/life/sessions/life-fixture').json()
                    assert life['state']['service']['lastRealtimeFactStored'] is False
                    passed('life-realtime-observation-does-not-persist-fact-value')
                    page.locator('[data-app="character"]').click()
                    expect(page.locator('[data-session="character-fixture"]')).to_be_visible()
                    page.locator('[data-tab="actions"]').click()
                    old = context.request.get(base + '/v1/character/sessions/character-fixture').json()
                    page.locator('[data-form="character-comfort"] button[type=submit]').click()
                    expect(page.locator('#notice')).to_contain_text('操作已记录')
                    new = context.request.get(base + '/v1/character/sessions/character-fixture').json()
                    assert new['state']['relationship']['trust'] > old['state']['relationship']['trust']
                    passed('character-event-changes-real-domain-state')
                    # Reload restores selected application / session / tab through URL state.
                    page.reload(wait_until='networkidle')
                    expect(page.locator('[data-app="character"]')).to_have_attribute('aria-current', 'page')
                    expect(page.locator('#session-heading')).to_contain_text('character-fixture')
                    expect(page.locator('[data-tab="actions"]')).to_have_attribute('aria-selected','true')
                    passed('url-selection-survives-page-reload')
                    # Stored attacker-controlled data remains literal text; scripts do not execute.
                    payload = '<img src=x onerror="window.PPL_XSS=1"><script>window.PPL_XSS=2</script>'
                    response = context.request.post(base + '/v1/research/sessions', data={'sessionId':'browser-xss','question':payload,'metadata':{'apiKey':'browser-secret'}})
                    assert response.status == 201
                    page.goto(base + '/#app=research&session=browser-xss&tab=overview', wait_until='networkidle')
                    expect(page.locator('#session-heading h2')).to_have_text(payload)
                    assert page.evaluate('window.PPL_XSS') is None
                    assert page.locator('#session-heading img, #session-heading script').count() == 0
                    assert 'browser-secret' not in page.locator('#content').inner_text()
                    passed('stored-html-is-inert-and-credential-field-redacted')
                    # Export includes useful state but no named credential fixture.
                    page.on('dialog', lambda dialog: dialog.accept())
                    with page.expect_download() as downloaded:
                        page.locator('#export').click()
                    download = downloaded.value
                    download.save_as(str(output / 'browser-export.json'))
                    exported = json.loads((output / 'browser-export.json').read_text())
                    assert exported['schema'] == 'ppl.observatory.export/1'
                    assert 'browser-secret' not in json.dumps(exported)
                    passed('browser-diagnostic-export-contains-records-not-known-credentials')
                    # Responsive viewport must not require sideways page scrolling.
                    page.set_viewport_size({'width':390,'height':844})
                    page.goto(base + '/#app=research&session=research-fixture-erasure&tab=handoffs', wait_until='networkidle')
                    expect(page.locator('[data-app="research"]')).to_be_visible()
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
                    page.screenshot(path=str(output / '04-mobile-observatory.png'), full_page=True)
                    passed('mobile-390px-layout-has-no-horizontal-page-overflow')
                    assert errors == [], errors
                    assert remote_requests == [], remote_requests
                    passed('no-page-javascript-errors-and-no-external-asset-requests')
                    report['passed'] = True
                    report['status'] = 'passed'
                    report['pageErrors'] = errors
                    report['externalRequests'] = remote_requests
                    context.close()
                    browser.close()
            except Exception as error:
                report['error'] = f'{type(error).__name__}: {error}'
                report['status'] = 'blocked-environment' if 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(error) else 'failed'
                raise
            finally:
                report['checkCount'] = len(checks)
                (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
