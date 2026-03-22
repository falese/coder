// Global type shim for the isolated TSC eval environment.
// `declare function` + `declare namespace` is the standard TypeScript merge
// pattern (same as jQuery's $). It makes React both a callable value (needed
// for JSX createElement calls with jsx: "react") and a type namespace
// (needed for React.FC<P>, React.forwardRef etc. annotations).
declare function React(...args: unknown[]): unknown;
declare namespace React {
  function createElement(...args: unknown[]): unknown;
  const Fragment: unknown;
  type FC<P = Record<string, unknown>> = (props: P) => unknown;
  type ReactNode = unknown;
  type ComponentType<P = Record<string, unknown>> = (props: P) => unknown;
  type Ref<T> = unknown;
  function forwardRef(render: unknown): unknown;
  function useState<S>(init: S | (() => S)): [S, (s: S) => void];
  function useCallback<T extends (...args: unknown[]) => unknown>(cb: T, deps: unknown[]): T;
  function useMemo<T>(factory: () => T, deps: unknown[]): T;
  function useEffect(effect: () => unknown, deps?: unknown[]): void;
  function useRef<T>(init?: T): { current: T };
  function useContext(ctx: unknown): unknown;
}
