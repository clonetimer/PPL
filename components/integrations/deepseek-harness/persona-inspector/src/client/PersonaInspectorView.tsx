import { useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { getPplInspectorSnapshot, type PplInspectorTurnState } from './contracts.ts'
import { EMPTY_PPL_INSPECTOR_SNAPSHOT } from './definition.ts'
import {
  changedTraces,
  formatValue,
  mutationStatus,
  mutations,
  relationshipRows,
} from './view-model.ts'
import type { MutationStatus } from './view-model.ts'
import css from './persona-inspector.module.css'

export interface PersonaInspectorInjected {
  loadOlder: () => Promise<boolean>
}

function shortHash(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 12)}…`
}

function statusLabel(entry: PplInspectorTurnState): string {
  if (entry.endReason === undefined) return '等待 Turn 结束'
  if (mutationStatus(entry) === 'applied') return entry.endReason === 'completed' ? '已提交' : `已提交 · ${entry.endReason}`
  return `未提交 · ${entry.endReason}`
}

const MUTATION_STATUS_CLASS: Readonly<Record<MutationStatus, string>> = {
  applied: css.applied!,
  discarded: css.discarded!,
  pending: css.pending!,
}

function mutationStatusClass(status: MutationStatus): string {
  return MUTATION_STATUS_CLASS[status]
}

function statusClass(entry: PplInspectorTurnState): string {
  return mutationStatusClass(mutationStatus(entry))
}

function eventLabel(entry: PplInspectorTurnState): string {
  const event = entry.snapshot.event
  const type = typeof event?.type === 'string' ? event.type : 'EVENT'
  const topic = typeof event?.topic === 'string' ? event.topic : undefined
  return topic === undefined ? type : `${type} · ${topic}`
}

function PersonaSummary({ entry }: { entry: PplInspectorTurnState }) {
  const persona = entry.snapshot.persona
  const rules = entry.snapshot.resolution.activeRules ?? []
  return (
    <section className={css.card}>
      <div className={css.cardHeader}>
        <div>
          <div className={css.eyebrow}>Persona</div>
          <h2 className={css.title}>{persona.id}</h2>
        </div>
        <span className={`${css.badge} ${statusClass(entry)}`}>{statusLabel(entry)}</span>
      </div>
      <dl className={css.metaGrid}>
        <div><dt>Version</dt><dd>{persona.version ?? '—'}</dd></div>
        <div><dt>Fingerprint</dt><dd title={persona.irSha256}>{shortHash(persona.irSha256)}</dd></div>
        <div><dt>Host Turn</dt><dd>{entry.snapshot.host.turn}</dd></div>
        <div><dt>Host Step</dt><dd>{entry.snapshot.host.step}</dd></div>
        <div><dt>Event</dt><dd>{eventLabel(entry)}</dd></div>
      </dl>
      <div className={css.ruleStrip}>
        {rules.length === 0
          ? <span className={css.muted}>本轮没有激活规则</span>
          : rules.map(rule => (
            <span className={css.ruleBadge} key={`${rule.id}:${rule.priority ?? ''}`}>
              {rule.id}{rule.priority === undefined ? '' : ` · P${rule.priority}`}
            </span>
          ))}
      </div>
    </section>
  )
}

function RelationshipCard({ entry }: { entry: PplInspectorTurnState }) {
  const rows = relationshipRows(entry)
  return (
    <section className={css.card}>
      <div className={css.eyebrow}>Relationship</div>
      <h3 className={css.sectionTitle}>关系状态</h3>
      {rows.length === 0
        ? <p className={css.muted}>当前 Snapshot 没有关系字段。</p>
        : <div className={css.kvList}>
          {rows.map(row => (
            <div className={css.kvRow} key={row.path}>
              <span className={css.kvKey}>{row.label}</span>
              <span className={css.kvValue}>{formatValue(row.value)}</span>
              {row.projected === undefined ? null : <>
                <span className={css.arrow}>→</span>
                <span className={css.kvValue}>{formatValue(row.projected)}</span>
                <span className={`${css.tinyBadge} ${mutationStatusClass(row.projectedStatus ?? 'pending')}`}>
                  {row.projectedStatus === 'applied' ? 'applied' : row.projectedStatus === 'discarded' ? 'discarded' : 'pending'}
                </span>
              </>}
            </div>
          ))}
        </div>}
    </section>
  )
}

function ComputedCard({ entry }: { entry: PplInspectorTurnState }) {
  const traces = changedTraces(entry)
  const [selected, setSelected] = useState<string | null>(traces[0]?.path ?? null)
  const selectedTrace = traces.find(trace => trace.path === selected) ?? traces[0]
  return (
    <section className={css.card}>
      <div className={css.eyebrow}>Computed Persona</div>
      <h3 className={css.sectionTitle}>Base → Resolved</h3>
      {traces.length === 0
        ? <p className={css.muted}>本轮没有记录可见的人格数值变化。</p>
        : <>
          <div className={css.traceList}>
            {traces.map(trace => (
              <button
                className={`${css.traceRow} ${selectedTrace?.path === trace.path ? css.traceSelected : ''}`}
                key={trace.path}
                type="button"
                onClick={() => setSelected(trace.path)}
              >
                <span className={css.tracePath}>{trace.path}</span>
                <span className={css.traceValue}>{formatValue(trace.base)}</span>
                <span className={css.arrow}>→</span>
                <strong className={css.traceValue}>{formatValue(trace.final)}</strong>
                {trace.deltaMagnitude === undefined ? null : <span className={css.delta}>{trace.deltaMagnitude}</span>}
              </button>
            ))}
          </div>
          {selectedTrace === undefined ? null : (
            <div className={css.whyBox}>
              <div className={css.whyTitle}>Why · {selectedTrace.path}</div>
              <div className={css.bandLine}>
                {selectedTrace.baseBand ?? 'base'} {formatValue(selectedTrace.base)}
                <span className={css.arrow}>→</span>
                {selectedTrace.finalBand ?? 'final'} {formatValue(selectedTrace.final)}
              </div>
              {selectedTrace.steps.length === 0
                ? <div className={css.muted}>没有 provenance step。</div>
                : selectedTrace.steps.map((step, index) => (
                  <div className={css.whyStep} key={`${step.rule}:${index}`}>
                    <strong>{step.rule}</strong>
                    <span>{step.priority === undefined ? '' : `P${step.priority}`}</span>
                    <span>{step.op} {formatValue(step.value)}</span>
                    <span>{formatValue(step.before)} → {formatValue(step.after)}</span>
                  </div>
                ))}
            </div>
          )}
        </>}
    </section>
  )
}

function MutationsCard({ entry }: { entry: PplInspectorTurnState }) {
  const rows = mutations(entry)
  return (
    <section className={css.card}>
      <div className={css.eyebrow}>Mutation</div>
      <h3 className={css.sectionTitle}>Commit / Transition</h3>
      {rows.length === 0
        ? <p className={css.muted}>本轮没有持久状态变更。</p>
        : <div className={css.mutationList}>
          {rows.map((row, index) => (
            <div className={css.mutationRow} key={`${row.kind}:${row.path}:${index}`}>
              <div>
                <strong>{row.source}</strong>
                <div className={css.mutationPath}>{row.path}</div>
              </div>
              <div className={css.mutationValue}>{formatValue(row.from)} → {formatValue(row.to)}</div>
              <span className={`${css.tinyBadge} ${mutationStatusClass(row.status)}`}>
                {row.status}
              </span>
            </div>
          ))}
        </div>}
    </section>
  )
}

export function PersonaInspectorView({ useSession, loadOlder }: ConvViewProps & InjectFace<PersonaInspectorInjected>) {
  const inspection = useSession(snapshot => getPplInspectorSnapshot(snapshot.views) ?? EMPTY_PPL_INSPECTOR_SNAPSHOT)
  const hasMore = useSession(snapshot => snapshot.hasMore)
  const loadingOlder = useSession(snapshot => snapshot.loadingOlder)
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const selected = useMemo(() => {
    if (inspection.entries.length === 0) return null
    return inspection.entries.find(entry => entry.snapshotSeq === selectedSeq)
      ?? inspection.latest
  }, [inspection, selectedSeq])

  if (selected === null) {
    return (
      <div className={css.emptyState}>
        <h2>Persona Inspector</h2>
        <p>这个 Session 里还没有持久化的 PPL Host Snapshot。</p>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <aside className={css.timeline}>
        <div className={css.timelineHeader}>
          <div>
            <div className={css.eyebrow}>PPL Timeline</div>
            <strong>{inspection.entries.length} snapshots</strong>
          </div>
          {hasMore ? (
            <button className={css.loadButton} type="button" disabled={loadingOlder} onClick={() => { void loadOlder() }}>
              {loadingOlder ? '加载中…' : '更早记录'}
            </button>
          ) : null}
        </div>
        <div className={css.timelineList}>
          {[...inspection.entries].reverse().map(entry => (
            <button
              key={entry.snapshotSeq}
              className={`${css.timelineRow} ${selected.snapshotSeq === entry.snapshotSeq ? css.timelineSelected : ''}`}
              type="button"
              onClick={() => setSelectedSeq(entry.snapshotSeq)}
            >
              <span className={css.timelineTurn}>Turn {entry.snapshot.host.turn} · Step {entry.snapshot.host.step}</span>
              <span className={css.timelineEvent}>{eventLabel(entry)}</span>
              <span className={`${css.dot} ${statusClass(entry)}`} aria-hidden="true" />
            </button>
          ))}
        </div>
      </aside>

      <main className={css.content}>
        <PersonaSummary entry={selected} />
        <div className={css.grid}>
          <RelationshipCard entry={selected} />
          <MutationsCard entry={selected} />
        </div>
        <ComputedCard key={selected.snapshotSeq} entry={selected} />
      </main>
    </div>
  )
}
