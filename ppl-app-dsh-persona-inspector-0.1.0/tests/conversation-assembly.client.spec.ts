import { describe, expect, it } from 'vitest'
import type {
  ConversationEventInput,
  ConversationNodeDefinition,
  ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import {
  EMPTY_PPL_INSPECTOR_SNAPSHOT,
  pplInspectorViewDefinition,
  pplSnapshotDefinition,
  pplTurnEndDefinition,
} from '../src/client/definition.ts'
import type { PplInspectorSnapshot } from '../src/client/contracts.ts'

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [pplSnapshotDefinition, pplTurnEndDefinition] }
  fallbackEntry(): undefined { return undefined }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [pplInspectorViewDefinition] }
}

function at(seq: number, type: string, data: unknown): ConversationEventInput {
  return {
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
    } as unknown as ConversationEventInput['event'],
    view: undefined,
  }
}

function pplSnapshot(seq: number, turn: number, step: number, projectedTrust: number, eventType = 'COMFORT') {
  return at(seq, 'user/message', {
    id: `ppl-${turn}-${step}`,
    role: 'user',
    content: [{ type: 'text', text: 'Current PPL persona runtime snapshot.' }],
    source: {
      kind: 'plugin',
      plugin: 'ppl-runtime',
      form: 'snapshot',
      ppl: {
        schema: 'ppl.host-snapshot/0.1',
        persona: {
          id: 'ZHUANG_FANGYI',
          version: '0.3.0',
          irSha256: 'abc123',
        },
        host: { kind: 'deepseek-harness', turn, step },
        event: { type: eventType, actor: 'admin', topic: 'fatigue' },
        resolution: {
          schema: 'ppl.host-resolution/0.1',
          activeRules: [
            { id: 'ADMIN_COMFORT_TRUST', priority: 540 },
            { id: 'PRIVATE_THAW', priority: 710 },
          ],
          resolved: {
            relationships: { admin: { stage: step === 1 ? 'trusted' : 'lover', trust: projectedTrust - 0.01 } },
          },
          trace: {
            'traits.emotional_guard': {
              path: 'traits.emotional_guard',
              base: 0.82,
              baseBand: 'very_high',
              steps: [
                { rule: 'PRIVATE_THAW', priority: 710, op: 'sub', value: 0.5, before: 0.82, after: 0.32 },
              ],
              raw: 0.32,
              final: 0.32,
              finalBand: 'low',
              delta: -0.5,
              deltaMagnitude: 'strong',
            },
          },
          pendingCommits: [
            {
              source: 'ADMIN_COMFORT_TRUST',
              op: 'add',
              path: 'relationships.admin.trust',
              value: 0.01,
              from: projectedTrust - 0.01,
              projected: projectedTrust,
            },
          ],
          pendingTransitions: [],
          valid: true,
        },
      },
    },
  })
}

function turnEnd(seq: number, turn: number, kind: string) {
  return at(seq, 'turn/end', { turn, reason: { kind } })
}

function createAssembler(): ConversationNodeAssembler {
  return new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
}

function snapshot(assembler: ConversationNodeAssembler): PplInspectorSnapshot {
  return (assembler.snapshot('ppl-inspector') as PplInspectorSnapshot | undefined)
    ?? EMPTY_PPL_INSPECTOR_SNAPSHOT
}

describe('PPL Persona Inspector conversation assembly', () => {
  it('pairs a durable PPL snapshot with completed turn/end', () => {
    const assembler = createAssembler()
    assembler.replaceWindow([
      pplSnapshot(5, 2, 1, 0.87),
      turnEnd(14, 2, 'completed'),
    ], false)
    assembler.flush()

    const value = snapshot(assembler)
    expect(value.entries).toHaveLength(1)
    expect(value.latest).toMatchObject({
      snapshotSeq: 5,
      endSeq: 14,
      endReason: 'completed',
      snapshot: {
        host: { turn: 2, step: 1 },
        persona: { id: 'ZHUANG_FANGYI' },
      },
    })
  })

  it('keeps an aborted PPL turn as history but marks its turn-end reason', () => {
    const assembler = createAssembler()
    assembler.replaceWindow([
      pplSnapshot(20, 3, 1, 0.88),
      turnEnd(30, 3, 'aborted'),
    ], false)
    assembler.flush()

    expect(snapshot(assembler).latest).toMatchObject({
      snapshotSeq: 20,
      endReason: 'aborted',
    })
  })

  it('supports multiple durable PPL snapshots in one steered turn', () => {
    const assembler = createAssembler()
    assembler.replaceWindow([
      pplSnapshot(40, 4, 1, 0.87, 'CONFESSION'),
      pplSnapshot(52, 4, 2, 0.88, 'COMFORT'),
      turnEnd(63, 4, 'max-tokens'),
    ], false)
    assembler.flush()

    const value = snapshot(assembler)
    expect(value.entries).toHaveLength(2)
    expect(value.entries.map(entry => entry.snapshot.host.step)).toEqual([1, 2])
    expect(value.entries.map(entry => entry.endReason)).toEqual(['max-tokens', 'max-tokens'])
    expect(value.latest).toMatchObject({ snapshotSeq: 52, endSeq: 63, endReason: 'max-tokens' })
  })

  it('joins an update-before-snapshot window when paging prepends the PPL snapshot', () => {
    const assembler = createAssembler()
    assembler.replaceWindow([turnEnd(30, 3, 'aborted')], true)
    assembler.flush()
    expect(snapshot(assembler).entries).toHaveLength(0)

    assembler.prepend([pplSnapshot(20, 3, 1, 0.88)], false)
    assembler.flush()

    expect(snapshot(assembler).latest).toMatchObject({
      snapshotSeq: 20,
      endSeq: 30,
      endReason: 'aborted',
    })
  })
})
