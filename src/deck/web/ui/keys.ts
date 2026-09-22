// keys.ts — tinykeys behind the app's global bindings. Centralized so the
// keymap is auditable in one place and no component re-registers raw
// window keydown listeners (the old per-component handlers could double-fire
// during state re-binds).
import { tinykeys } from "tinykeys";

/** Global app shortcuts, bound once from App. Returns the unbind function. */
export function bindGlobalKeys(handlers: {
  openPalette: () => void;
}): () => void {
  return tinykeys(window, {
    "$mod+k": (e: KeyboardEvent) => {
      e.preventDefault();
      handlers.openPalette();
    },
  });
}
