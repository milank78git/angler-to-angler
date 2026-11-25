import type { Navigation } from '../app/src/main/assets/navigation.js';

/** Shared screen services. Domain state is supplied by the individual route. */
export interface ScreenContext {
  nav: Navigation;
  view: {
    route: Record<string, any>;
    active(): boolean;
    dispose(): void;
    refreshWaters?(directory: ScreenContext['waterDirectory']): void;
    dirty: boolean;
    saving: boolean;
  };
  waterDirectory: ReturnType<typeof import('../app/src/main/assets/water-directory.js').createWaterDirectory>;
  pack: typeof import('../app/src/main/assets/catalog.json');
  rivers: typeof import('../app/src/main/assets/rivers.json');
  hints: Record<string, { topic: string; message: string }>;
}
