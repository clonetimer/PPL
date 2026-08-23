import { createObservatory } from '@ppl/app-ui'
import { verifyEvidenceBundle } from '@ppl/app-core'

const app = createObservatory(document.querySelector('#observatory'))
const status = document.querySelector('#status')
const sampleMap = {
  persona: './sample/persona-reference.app-session.json',
  tutor: './sample/tutor-application-cycle.app-session.json',
  tutorReal70363: './sample/tutor-assistments-70363.app-session.json',
  tutorReal70729: './sample/tutor-assistments-70729.app-session.json',
  tutorNumberLine: './sample/tutor-assistments-70363-number-line.app-session.json',
  tutorCircle: './sample/tutor-assistments-70363-circle-graph.app-session.json',
  research: './sample/research-application-cycle.app-session.json',
  researchConflict: './sample/research-bilingual-conflict.app-session.json',
  researchLigo: './sample/research-ligo-strong-validation.app-session.json',
  researchEgoFlip: './sample/research-ego-evidence-flip.app-session.json',
  researchEgoRefute: './sample/research-ego-strong-refutation.app-session.json',
  life: './sample/life-service-cycle.app-session.json',
}

function notify(message, isError = false) {
  status.textContent = message
  status.style.borderColor = isError ? '#ff7286' : '#4fd49a'
  status.classList.add('show')
  clearTimeout(notify.timer)
  notify.timer = setTimeout(() => status.classList.remove('show'), 5000)
}

async function usePayload(payload, source) {
  if (payload?.schema === 'ppl.app-evidence-bundle/0.1') {
    const verification = verifyEvidenceBundle(payload)
    if (!verification.passed) throw new Error(`Evidence Bundle integrity mismatch: ${verification.actual} != ${verification.expected}`)
    payload = payload.session
  }
  app.setSession(payload)
  notify(`已加载：${source}`)
}

async function loadUrl(url, source = url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  await usePayload(await response.json(), source)
}

document.querySelector('#loadSample').addEventListener('click', async () => {
  const key = document.querySelector('#sample').value
  try { await loadUrl(sampleMap[key], key) } catch (error) { notify(error.message, true) }
})
document.querySelector('#file').addEventListener('change', async event => {
  const file = event.target.files?.[0]
  if (!file) return
  try { await usePayload(JSON.parse(await file.text()), file.name) } catch (error) { notify(`导入失败：${error.message}`, true) }
})
document.querySelector('#loadUrl').addEventListener('click', async () => {
  const url = document.querySelector('#url').value.trim()
  if (!url) return
  try { await loadUrl(url) } catch (error) { notify(`URL 加载失败：${error.message}`, true) }
})

loadUrl(sampleMap.persona, 'persona-reference').catch(error => notify(error.message, true))
