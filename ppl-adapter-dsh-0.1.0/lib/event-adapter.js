export function textOfMessage(message) {
  return (message.content ?? [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => String(block.text))
    .join('\n')
    .trim()
}

export function directHumanMessages(messages) {
  return messages.filter(message => message?.source?.kind === 'user')
}

/**
 * Deliberately deterministic reference Event Adapter.
 * Production deployments should replace this Host seam rather than change PPL Core.
 */
export class BasicZhEventAdapter {
  classify(messages) {
    const humans = directHumanMessages(messages)
    const text = humans.map(textOfMessage).filter(Boolean).join('\n')
    if (!text) return { type: 'MESSAGE', actor: 'admin', text: '' }
    if (/(喜欢你|爱你|和我在一起|交往|告白)/u.test(text)) {
      return { type: 'CONFESSION', actor: 'admin', target: 'self', topic: 'relationship', text }
    }
    if (/(辛苦|累了|很累|休息|靠一会|靠着|别撑|别逞强)/u.test(text)) {
      return { type: 'COMFORT', actor: 'admin', target: 'self', topic: 'fatigue', text }
    }
    return { type: 'MESSAGE', actor: 'admin', target: 'self', text }
  }
}
