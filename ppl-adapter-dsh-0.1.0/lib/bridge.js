import { PersonaRuntime } from '@ppl/runtime'
import { BasicZhEventAdapter, directHumanMessages } from './event-adapter.js'
import { existingPersonaBinding, projectRuntimeFromSession } from './dsh-projection.js'

export const DSH_DEFAULT_COMMIT_REASONS = Object.freeze(['completed', 'max-tokens'])

export class PplDshBridge {
  constructor(config) {
    this.runtime = new PersonaRuntime({
      persona: config.persona,
      scene: config.scene,
      context: config.context,
      profile: config.profile ?? 'standard',
    })
    this.ir = config.persona
    this.eventAdapter = config.eventAdapter ?? new BasicZhEventAdapter()
    // DSH max-tokens is a durable terminal outcome after the model output has
    // been recorded; it is not a rollback/cancellation signal. Abort/error/
    // blocked/interrupted remain non-committing by default.
    this.commitReasons = config.commitReasons ?? DSH_DEFAULT_COMMIT_REASONS
  }

  assertSessionBinding(events) {
    const existing = existingPersonaBinding(events)
    if (!existing) return
    const configured = this.runtime.personaBinding()
    if (existing.id !== configured.id || existing.irSha256 !== configured.irSha256) {
      throw new Error(`PPL persona binding mismatch: session=${existing.id}@${existing.irSha256.slice(0, 12)}, configured=${configured.id}@${configured.irSha256.slice(0, 12)}`)
    }
  }

  projectRuntime(events, sessionId) {
    this.assertSessionBinding(events)
    return projectRuntimeFromSession(this.ir, events, sessionId, { commitReasons: this.commitReasons })
  }

  projectStagedRuntime(events, sessionId) {
    this.assertSessionBinding(events)
    return projectRuntimeFromSession(this.ir, events, sessionId, {
      commitReasons: this.commitReasons,
      includePending: true,
    })
  }

  staticPrompt(events, sessionId) {
    return this.runtime.staticPrompt(this.projectRuntime(events, sessionId))
  }

  prepareStep(input) {
    // Tool-only continuation is not a new Persona event. A direct human steer
    // at step>1 is, and must be resolved against earlier staged PPL snapshots
    // from the same host turn without committing them early.
    const humans = directHumanMessages(input.messages)
    if (humans.length === 0) return undefined

    const runtimeBefore = this.projectStagedRuntime(input.events, input.sessionId)
    const event = this.eventAdapter.classify(humans)
    const prepared = this.runtime.resolveHostStep({
      runtime: runtimeBefore,
      context: {},
      event,
      hostKind: 'deepseek-harness',
      turn: input.turn,
      step: input.step,
    })
    return { runtimeBefore, event, ...prepared, metadata: prepared.snapshot }
  }
}
