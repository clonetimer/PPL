// Explicit HTTP test double. NEVER loaded by the normal Gateway or qualification CLI.
import http from 'node:http'
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))}
function requestFrom(body) {
  for (const message of body.messages || []) if(message.role==='user') {
    try { const value=JSON.parse(message.content); if(value?.schema)return value } catch {}
  }
  throw new Error('Missing PPL request in test HTTP body')
}
export async function startQualificationFixture(options = {}) {
  const calls=[]
  const server=http.createServer(async(req,res)=>{
    try {
      let raw='';for await(const chunk of req)raw+=chunk
      const body=JSON.parse(raw || '{}')
      if(req.url==='/retrieve') {
        calls.push({role:'retrieval'})
        return send(res,200,{documents:options.emptyRetrieval?[]:[
          {id:'a',title:'Fixture Study A',url:'https://example.test/a',text:'Synthetic source A reports method A faster than B.'},
          {id:'b',title:'Fixture Study B',url:'https://example.test/b',text:'Synthetic source B reports method A slower than B.'},
        ].slice(0,body.limit || 5)})
      }
      const request=requestFrom(body),role=request.modelRole
      calls.push({role})
      let value
      if(role==='endpoint-probe') value=options.badProbe?{schema:'ppl.execution-probe-response/2',ok:false,nonce:'stale'}:{schema:'ppl.execution-probe-response/2',ok:true,nonce:request.nonce}
      else if(role==='research-evidence-extractor') {
        const oppose=request.document.documentId==='b'
        value={schema:'ppl.product.research-evidence-extraction/1',relevant:true,canonicalText:request.document.text,polarity:oppose?'oppose':'support',confidence:.7,rationale:'Synthetic fixture snippet'}
      } else if(role==='bound-delivery-judge') {
        const negative=String(request.derivedConclusion?.text || '').includes('Both synthetic benchmarks establish')
        const accept=options.judgeMode==='always-pass'?true:options.judgeMode==='always-fail'?false:!negative
        value={schema:'ppl.multi-agent.bound-delivery-fidelity-judge-result/0.1',handoffId:options.judgeMode==='wrong-binding'?'wrong':request.handoffId,bindingId:request.bindingId,
          pass:accept,counterEvidenceIntegrated:accept,uncertaintyCalibrated:accept,attributionPreservation:true,metricScopePreservation:true,conclusionSupported:accept,noNovelFacts:true,findings:accept?[]:['Synthetic contradiction detected']}
      } else if(role==='reviewer') value={schema:'ppl.product.research-review-response/1',derivedConclusion:'The synthetic evidence is mixed; consistent superiority is not established.',claims:request.handoff.payload.claims}
      else value={schema:options.analystFault==='schema' && role==='analyst'?'wrong/1':'ppl.product.handoff-receiver-response/1',message:'Both sides retained in fixture response.',
        claims:options.analystFault==='erasure' && role==='analyst'?request.handoff.payload.claims.filter(c=>c.polarity!=='oppose'):request.handoff.payload.claims}
      send(res,200,{id:'fixture-response',model:body.model,choices:[{message:{role:'assistant',content:JSON.stringify(value)}}],usage:{prompt_tokens:1,completion_tokens:1}})
    } catch { send(res,500,{error:{message:'R4 fixture backend failed'}}) }
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${server.address().port}`
  return {calls,env:{PPL_EXECUTION_ENABLED:'1',PPL_AGENT_PRESET:'vllm',PPL_JUDGE_PRESET:'vllm',PPL_AGENT_MODEL:'r4-http-fixture-agent',PPL_JUDGE_MODEL:'r4-http-fixture-judge',
    PPL_AGENT_ENDPOINT:`${base}/v1/chat/completions`,PPL_JUDGE_ENDPOINT:`${base}/v1/chat/completions`,PPL_MODEL_INDEPENDENCE:'required',PPL_RETRIEVAL_KIND:'http',PPL_RETRIEVAL_ENDPOINT:`${base}/retrieve`,
    PPL_HTTP_TIMEOUT_MS:'2000',PPL_AGENT_API_KEY:'R4_TEST_ONLY_SECRET',PPL_JUDGE_API_KEY:'R4_TEST_ONLY_SECRET'},
    close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})}
}
