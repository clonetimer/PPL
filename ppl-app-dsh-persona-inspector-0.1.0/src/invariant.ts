/**
 * Package-owned invariant companion for `@ppl/app-dsh-persona-inspector`.
 *
 * The Persona Inspector is a pure client-side consumer: it registers a
 * conversation event assembler, a view materializer, and one slot entry, but
 * it does not own mutable cross-plugin state or emit its own Cordis events.
 * Slot/event/view ledgers already enforce disposal correctness. The companion
 * therefore only reserves package ownership in Harness' invariant test host.
 */
import type { Context } from '@deepseek-ai/cordis'

const PACKAGE_NAME = '@ppl/app-dsh-persona-inspector'

type InvariantContext = Context & {
  invariants: {
    register(owner: string, install: () => void): () => void
  }
}

/** Cordis companion plugin name. */
export const name = 'ppl-app-dsh-persona-inspector-invariant'
/** Harness test host requires every package companion to inject this service. */
export const inject = ['invariants']

/** No additional runtime invariant beyond the shared registries' own ledgers. */
const install = (): void => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve((ctx as InvariantContext).invariants.register(PACKAGE_NAME, install))
