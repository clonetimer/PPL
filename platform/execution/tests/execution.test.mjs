import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createStaticRetrievalProvider,
  createHttpJsonRetrievalProvider,
  createOpenAICompatibleChatTransport,
  invokeStructured,
  RecordStoreToolExecutionStore,
  ToolExecutionLedger,
  createToolRegistry,
} from '../src/index.mjs'
import { SqliteRecordStore } from '@ppl/platform-core'

test('static retrieval ranks and limits documents', async () => {
  const provider = createStaticRetrievalProvider([
    { id:'a', title:'Alpha', text:'transformer benchmark supports method A' },
    { id:'b', title:'Beta', text:'unrelated weather note' },
  ])
  const out = await provider.retrieve({ query:'transformer method', limit:1 })
  assert.equal(out.documents.length, 1)
  assert.equal(out.documents[0].documentId, 'a')
})

test('HTTP JSON retrieval uses real network transport contract', async t => {
  const server = http.createServer(async (req,res) => {
    let raw=''; for await (const chunk of req) raw += chunk
    const body=JSON.parse(raw)
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify({ documents:[{ id:'net1', title:'Network', url:'https://example.test/x', text:`result for ${body.query}` }] }))
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); t.after(() => server.close())
  const port=server.address().port
  const provider=createHttpJsonRetrievalProvider({endpoint:`http://127.0.0.1:${port}/retrieve`})
  const out=await provider.retrieve({query:'evidence',limit:2})
  assert.equal(out.documents[0].documentId,'net1')
  assert.match(out.documents[0].text,/evidence/)
})

test('OpenAI-compatible adapter performs structured HTTP invocation', async t => {
  const server=http.createServer(async (req,res) => {
    let raw=''; for await (const chunk of req) raw += chunk
    const body=JSON.parse(raw)
    assert.equal(body.model,'mock-model')
    assert.equal(body.response_format.type,'json_schema')
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify({id:'resp1',choices:[{message:{content:JSON.stringify({schema:'test/1',ok:true})}}],usage:{prompt_tokens:1,completion_tokens:1}}))
  })
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); t.after(() => server.close())
  const port=server.address().port
  const transport=createOpenAICompatibleChatTransport({preset:'vllm',endpoint:`http://127.0.0.1:${port}/v1/chat/completions`,model:'mock-model'})
  const result=await invokeStructured(transport,{schema:'test-request/1',instructions:['test'],responseContract:{jsonSchema:{type:'object',additionalProperties:false,required:['schema','ok'],properties:{schema:{type:'string',enum:['test/1']},ok:{type:'boolean'}}}}})
  assert.equal(result.ok,true)
  assert.equal(result.value.ok,true)
})


test('shared RecordStore persists completed Host tool ledger entries across restart', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppl-r2-tool-ledger-'))
  const db=path.join(dir,'ppl.sqlite')
  let executions=0
  const registry=createToolRegistry([{name:'lookup',parameters:{type:'object',additionalProperties:false,required:['key'],properties:{key:{type:'string'}}},execute:async({key})=>{executions++;return {value:key,executions}}}])
  let store=new SqliteRecordStore(db)
  let ledger=new ToolExecutionLedger({store:new RecordStoreToolExecutionStore(store,'tool-test')})
  const first=await ledger.execute(registry,{callId:'session:handoff:call-1',name:'lookup',arguments:{key:'x'}})
  assert.equal(first.replayed,false)
  assert.equal(executions,1)
  store.close()

  store=new SqliteRecordStore(db)
  ledger=new ToolExecutionLedger({store:new RecordStoreToolExecutionStore(store,'tool-test')})
  const replay=await ledger.execute(registry,{callId:'session:handoff:call-1',name:'lookup',arguments:{key:'x'}})
  assert.equal(replay.replayed,true)
  assert.equal(executions,1)
  store.close()
})
