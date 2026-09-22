// -----------------------------------------------------------------------------
// Scene surface of the integration: what a scene can REACT to, and what it can
// ASK for.
//
// Both halves are declared in the manifest (`scene_triggers` and
// `scene_actions`) and wired in `index.js` by key, exactly like the manifest
// actions. A test ties the two sides together, because the failure mode is
// silent: a declared key with no handler is a card in the scene editor that
// does nothing, and a handler with no declaration is code nobody can reach —
// the core answers 404 on an event whose key it does not know.
//
// Keys are FOREVER: a scene stores the key it was built with, so renaming one
// is removing it for every scene already using it.
// -----------------------------------------------------------------------------

export { OVERALL_POLLUTANT, SCENE_ACTION_HANDLERS } from './sceneActions.js';
export {
  indexTransitions,
  publishIndexEvents,
  resetIndexMemory,
  SCENE_TRIGGERS,
} from './indexEvents.js';
