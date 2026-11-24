/**
 * App actions for the situation room. Voice, typed chat, the z0live `globe`
 * tool and agents call these through the one action runner; each returns an
 * honest result: ok only when the card shows real data, `unavailable` with
 * the reason (a missing server key, a source that did not answer) when not.
 */

export const SITUATION_ACTIONS = Object.freeze([
  'set_situation_mode',
  'show_card',
  'brief',
  'pin_card',
  'dismiss_card',
  'focus_event',
]);

const ACTIONS = new Set(SITUATION_ACTIONS);

export function isSituationAction(name) {
  return ACTIONS.has(name);
}

/** Run one situation action against the controller, or say why not. */
export async function runSituationAction(
  situation,
  name,
  args = {},
  { signal, origin } = {},
) {
  if (!situation)
    return {
      ok: false,
      action: name,
      unavailable: true,
      error: 'The situation room is not available on this page.',
    };
  const options = { signal, origin: origin ?? 'agent' };
  switch (name) {
    case 'set_situation_mode': {
      const enabled = situation.setEnabled(args.enabled !== false);
      return {
        ok: true,
        action: name,
        enabled,
        say: enabled ? 'Situation room on.' : 'Situation room off.',
      };
    }
    case 'show_card':
      return situation.showCard(args, options);
    case 'brief':
      return situation.brief(args, options);
    case 'pin_card':
      return situation.pin(args);
    case 'dismiss_card':
      return situation.dismiss(args);
    case 'focus_event':
      return situation.focusEvent(args, options);
    default:
      return {
        ok: false,
        action: name,
        error: `Unknown situation action ${name}`,
      };
  }
}
