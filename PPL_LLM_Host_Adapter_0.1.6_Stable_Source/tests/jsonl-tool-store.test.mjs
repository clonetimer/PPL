import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AppendOnlyJsonlToolExecutionStore, ToolExecutionLedger, createToolRegistry } from '../src/tools.mjs'

function tempLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppl-jsonl-ledger-'))
  return { dir, file: path.join(dir, 'ledger.jsonl') }
}

test('append-only JSONL tool store preserves replay semantics across restart', async () => {
  const {dir,file}=tempLedger(); let effects=0
  try {
    const registry=createToolRegistry([{name:'effect',parameters:{type:'object',additionalProperties:false,required:['n'],properties:{n:{type:'integer'}}},execute:async({n})=>{effects++;return {n,effects}}}])
    let ledger=new ToolExecutionLedger({store:new AppendOnlyJsonlToolExecutionStore(file)})
    const first=await ledger.execute(registry,{callId:'c1',name:'effect',arguments:{n:1}})
    assert.equal(first.replayed,false); assert.equal(effects,1)
    ledger=new ToolExecutionLedger({store:new AppendOnlyJsonlToolExecutionStore(file)})
    const second=await ledger.execute(registry,{callId:'c1',name:'effect',arguments:{n:1}})
    assert.equal(second.replayed,true); assert.equal(effects,1); assert.deepEqual(second.output,first.output)
    await assert.rejects(()=>ledger.execute(registry,{callId:'c1',name:'effect',arguments:{n:2}}),/reused with different/)
  } finally { fs.rmSync(dir,{recursive:true,force:true}) }
})

test('append-only JSONL store supports explicit tombstone delete across restart', async () => {
  const {dir,file}=tempLedger()
  try {
    let store=new AppendOnlyJsonlToolExecutionStore(file)
    await store.set('c1',{identity:'x',result:{ok:true}})
    await store.delete('c1')
    store=new AppendOnlyJsonlToolExecutionStore(file)
    assert.equal(await store.get('c1'),null)
    assert.equal(await store.size(),0)
    const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/)
    assert.equal(lines.length,2)
  } finally { fs.rmSync(dir,{recursive:true,force:true}) }
})
