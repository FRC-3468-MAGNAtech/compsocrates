// A tiny synchronous React hook runtime for node tests (no jsdom in this repo). Tests mock "react" with `hookMock(actual)` and drive a hook with
// `renderHook(() => useThing())`. Effects run after every render, setState re-renders at once, and `settle()` waits for promises. It supports exactly the
// hooks the data layer uses; it is test-only and never imported by app code.

type Slot = { value?: unknown; deps?: readonly unknown[] | undefined; cleanup?: (() => void) | void; setter?: (v: unknown) => void; ref?: { current: unknown } };
type Instance = { slots: Slot[]; index: number; dirty: boolean; rendering: boolean; pending: { slot: Slot; fn: () => (() => void) | void }[]; render: () => void; unmounted: boolean };

let current: Instance | null = null;
const provided = new Map<object, unknown>();

function slotAt(): Slot {
  if (!current) throw new Error("hook called outside renderHook");
  const inst = current;
  const slot = (inst.slots[inst.index] ??= {});
  inst.index += 1;
  return slot;
}

const depsChanged = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));

function queueEffect(fn: () => (() => void) | void, deps?: readonly unknown[]) {
  const inst = current!;
  const slot = slotAt();
  const first = !("deps" in slot);
  if (first || deps === undefined || depsChanged(slot.deps, deps)) {
    slot.deps = deps;
    inst.pending.push({ slot, fn });
  }
}

export function hookMock<T extends object>(actual: T) {
  const useState = (init: unknown) => {
    const inst = current!;
    const slot = slotAt();
    if (!("value" in slot)) slot.value = typeof init === "function" ? (init as () => unknown)() : init;
    slot.setter ??= (v: unknown) => {
      const next = typeof v === "function" ? (v as (p: unknown) => unknown)(slot.value) : v;
      if (Object.is(next, slot.value) || inst.unmounted) return;
      slot.value = next;
      inst.dirty = true;
      if (!inst.rendering && batchDepth === 0) inst.render();
    };
    return [slot.value, slot.setter];
  };
  const overrides = {
    useState,
    useReducer: (reducer: (s: unknown, a: unknown) => unknown, init: unknown) => {
      const [state, set] = useState(init) as [unknown, (v: (p: unknown) => unknown) => void];
      return [state, (action: unknown) => set((p) => reducer(p, action))];
    },
    useEffect: queueEffect,
    useLayoutEffect: queueEffect,
    useInsertionEffect: queueEffect,
    useMemo: (fn: () => unknown, deps: readonly unknown[]) => {
      const slot = slotAt();
      if (!("value" in slot) || depsChanged(slot.deps, deps)) {
        slot.value = fn();
        slot.deps = deps;
      }
      return slot.value;
    },
    useCallback: (fn: unknown, deps: readonly unknown[]) => {
      const slot = slotAt();
      if (!("value" in slot) || depsChanged(slot.deps, deps)) {
        slot.value = fn;
        slot.deps = deps;
      }
      return slot.value;
    },
    useRef: (init: unknown) => {
      const slot = slotAt();
      slot.ref ??= { current: init };
      return slot.ref;
    },
    useId: () => "id",
    useTransition: () => [false, (fn: () => void) => fn()],
    useDeferredValue: (v: unknown) => v,
    useContext: (ctx: { _currentValue?: unknown; _currentValue2?: unknown }) => (provided.has(ctx) ? provided.get(ctx) : (ctx._currentValue ?? ctx._currentValue2)),
    useSyncExternalStore: (subscribe: (cb: () => void) => () => void, getSnapshot: () => unknown) => {
      const [, bump] = useState(0) as [unknown, (v: (p: number) => number) => void];
      queueEffect(() => subscribe(() => bump((n) => n + 1)), [subscribe]);
      return getSnapshot();
    },
  };
  return { ...actual, ...overrides, default: { ...((actual as { default?: object }).default ?? {}), ...overrides } };
}

let batchDepth = 0;

/** Make `useContext(ctx)` return `value` for the hook under test. */
export function provideContext(ctx: object, value: unknown): void {
  provided.set(ctx, value);
}
export function clearContexts(): void {
  provided.clear();
}

export type HookHandle<R> = { readonly result: { current: R }; rerender: () => void; unmount: () => void; renders: () => number };

export function renderHook<R>(hook: () => R): HookHandle<R> {
  const inst: Instance = { slots: [], index: 0, dirty: false, rendering: false, pending: [], render: () => {}, unmounted: false };
  const result = { current: undefined as R };
  let renders = 0;
  inst.render = () => {
    if (inst.unmounted) return;
    for (let guard = 0; guard < 50; guard += 1) {
      inst.dirty = false;
      inst.rendering = true;
      inst.index = 0;
      inst.pending = [];
      const previous = current;
      current = inst;
      try {
        result.current = hook();
        renders += 1;
      } finally {
        current = previous;
      }
      const pending = inst.pending;
      inst.pending = [];
      try {
        for (const { slot } of pending) {
          const cleanup = slot.cleanup;
          slot.cleanup = undefined;
          if (typeof cleanup === "function") cleanup();
        }
        for (const { slot, fn } of pending) slot.cleanup = fn();
      } finally {
        inst.rendering = false;
      }
      if (!inst.dirty) return;
    }
    throw new Error("hook render loop did not settle");
  };
  inst.render();
  return {
    result,
    rerender: () => inst.render(),
    renders: () => renders,
    unmount: () => {
      inst.unmounted = true;
      for (const slot of inst.slots) if (typeof slot.cleanup === "function") slot.cleanup();
    },
  };
}

/** Let pending promises and the fake Firestore's queued snapshots run. */
export async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function batch(fn: () => void): void {
  batchDepth += 1;
  try {
    fn();
  } finally {
    batchDepth -= 1;
  }
}
