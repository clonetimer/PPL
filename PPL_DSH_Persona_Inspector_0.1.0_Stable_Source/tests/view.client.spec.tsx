// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PersonaInspectorView, type PersonaInspectorInjected } from '../src/client/PersonaInspectorView.tsx'
import type { PplInspectorTurnState } from '../src/client/contracts.ts'

function entry(endReason: string): PplInspectorTurnState {
  return {
    snapshotSeq: 22,
    endSeq: 31,
    endReason,
    snapshot: {
      schema: 'ppl.host-snapshot/0.1',
      persona: { id: 'ZHUANG_FANGYI', version: '0.3.0', irSha256: 'abcdef1234567890' },
      host: { kind: 'deepseek-harness', turn: 2, step: 1 },
      event: { type: 'COMFORT', actor: 'admin', topic: 'fatigue' },
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
            steps: [
              { rule: 'PRIVATE_THAW', priority: 710, op: 'sub', value: 0.5, before: 0.82, after: 0.32 },
            ],
            final: 0.32,
            finalBand: 'low',
            delta: -0.5,
            deltaMagnitude: 'strong',
          },
        },
        pendingCommits: [
          { source: 'ADMIN_COMFORT_TRUST', op: 'add', path: 'relationships.admin.trust', value: 0.01, from: 0.86, projected: 0.87 },
        ],
        pendingTransitions: [],
        valid: true,
      },
    },
  }
}

afterEach(cleanup)

function renderInspector(endReason: string) {
  const current = entry(endReason)
  const inspection = { entries: [current], latest: current }
  const sessionSnapshot = {
    views: { get: (target: string) => target === 'ppl-inspector' ? inspection : undefined },
    hasMore: false,
    loadingOlder: false,
  }
  const useSession = ((selector: (value: unknown) => unknown) => selector(sessionSnapshot)) as never
  const props = {
    sessionId: 's1',
    useSession,
    loadOlder: async () => false,
  } as unknown as ConvViewProps & PersonaInspectorInjected
  return render(<PersonaInspectorView {...props} />)
}

describe('PPL Persona Inspector view', () => {
  it('renders recorded persona state and provenance without rerunning PPL', () => {
    const view = renderInspector('completed')
    expect(screen.getByText('ZHUANG_FANGYI')).toBeTruthy()
    expect(screen.getByText('PRIVATE_THAW · P710')).toBeTruthy()
    expect(screen.getByText('traits.emotional_guard')).toBeTruthy()
    expect(view.container.textContent).toContain('0.82')
    expect(view.container.textContent).toContain('0.32')
    expect(view.container.textContent).toContain('admin.trust')
    expect(view.container.textContent).toContain('0.87')
    expect(view.container.textContent).toContain('applied')
  })

  it('renders an aborted mutation as discarded', () => {
    const view = renderInspector('aborted')
    expect(view.container.textContent).toContain('未提交 · aborted')
    expect(view.container.textContent).toContain('discarded')
  })
})
