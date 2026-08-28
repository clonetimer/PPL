import { describe, expect, it } from 'vitest'
import {
  changedTraces,
  mutationStatus,
  mutations,
  relationshipRows,
} from '../src/client/view-model.ts'
import type { PplInspectorTurnState } from '../src/client/contracts.ts'

function fixture(endReason: string | undefined = 'completed'): PplInspectorTurnState {
  return {
    snapshotSeq: 22,
    ...(endReason === undefined ? {} : { endSeq: 31, endReason }),
    snapshot: {
      schema: 'ppl.host-snapshot/0.1',
      persona: { id: 'ZHUANG_FANGYI', version: '0.3.0', irSha256: 'abc123' },
      host: { kind: 'deepseek-harness', turn: 2, step: 1 },
      event: { type: 'COMFORT', actor: 'admin' },
      resolution: {
        schema: 'ppl.host-resolution/0.1',
        activeRules: [
          { id: 'ADMIN_COMFORT_TRUST', priority: 540 },
          { id: 'PRIVATE_THAW', priority: 710 },
        ],
        resolved: {
          relationships: { admin: { stage: 'lover', trust: 0.86 } },
        },
        trace: {
          'traits.emotional_guard': {
            path: 'traits.emotional_guard',
            base: 0.82,
            baseBand: 'very_high',
            steps: [{ rule: 'PRIVATE_THAW', priority: 710, op: 'sub', value: 0.5, before: 0.82, after: 0.32 }],
            final: 0.32,
            finalBand: 'low',
            delta: -0.5,
            deltaMagnitude: 'strong',
          },
        },
        pendingCommits: [{ source: 'ADMIN_COMFORT_TRUST', op: 'add', path: 'relationships.admin.trust', value: 0.01, from: 0.86, projected: 0.87 }],
        pendingTransitions: [],
        valid: true,
      },
    },
  }
}

describe('PPL Persona Inspector view model', () => {
  it('shows completed mutation as applied without rerunning PPL', () => {
    const entry = fixture('completed')
    expect(mutationStatus(entry)).toBe('applied')
    expect(mutations(entry)[0]).toMatchObject({ path: 'relationships.admin.trust', from: 0.86, to: 0.87, status: 'applied' })
    expect(relationshipRows(entry)).toContainEqual(expect.objectContaining({ label: 'admin.trust', value: 0.86, projected: 0.87, projectedStatus: 'applied' }))
  })

  it('shows aborted mutation as discarded', () => {
    const entry = fixture('aborted')
    expect(mutations(entry)[0]?.status).toBe('discarded')
  })

  it('shows DSH max-tokens mutation as applied', () => {
    const entry = fixture('max-tokens')
    expect(mutationStatus(entry)).toBe('applied')
    expect(mutations(entry)[0]?.status).toBe('applied')
  })

  it('surfaces recorded provenance trace', () => {
    const trace = changedTraces(fixture())[0]
    expect(trace).toMatchObject({ path: 'traits.emotional_guard', base: 0.82, final: 0.32, delta: -0.5 })
    expect(trace?.steps[0]).toMatchObject({ rule: 'PRIVATE_THAW', before: 0.82, after: 0.32 })
  })
})
