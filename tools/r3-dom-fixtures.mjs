// Build real read-model snapshots for the offline DOM harness. No browser/server network involved.
import { MemoryRecordStore } from '@ppl/platform-core'
import { createFixtureRuntime, seedFixtureRuntime } from './fixtures/r3-runtime.mjs'
import { ObservatoryReadModel } from '@ppl/product-observatory'
const runtime=await seedFixtureRuntime(createFixtureRuntime(new MemoryRecordStore()))
const payload='<img src=x onerror="window.PPL_XSS=1"><script>window.PPL_XSS=2</script>'
runtime.research.createSession({sessionId:'dom-xss',question:payload,metadata:{apiKey:'dom-secret'}})
const view=new ObservatoryReadModel(runtime)
const list=view.sessions({limit:100})
const routes={'/v1/observatory/status':view.status()}
for(const s of list.items){
  const base=`/v1/observatory/apps/${s.app}/sessions/${encodeURIComponent(s.sessionId)}`
  routes[base]=view.detail(s.app,s.sessionId)
  routes[base+'/audit']=view.audit(s.app,s.sessionId,{limit:100})
  routes[base+'/executions']=view.executions(s.app,s.sessionId,{limit:100})
  routes[base+'/export']=view.export(s.app,s.sessionId)
  for(const r of routes[base+'/executions'].items)routes[base+'/executions/'+r.runId]=view.execution(s.app,s.sessionId,r.runId)
}
console.log(JSON.stringify({schema:'ppl.r3-dom-fixtures/1',list,routes,xssPayload:payload}))
