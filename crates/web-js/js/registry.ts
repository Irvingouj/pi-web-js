// Host handler registry for web-js
// Provides registerHostHandler / registerHostHandlers for the optional
// host.call() extension point.

const hostHandlers: Record<string, (params: unknown) => Promise<unknown>> = {};

export function registerHostHandler<T, R>(
  action: string,
  handler: (params: T) => Promise<R>,
) {
  hostHandlers[action] = handler as (params: unknown) => Promise<unknown>;
}

export function registerHostHandlers(
  handlers: Record<string, (params: unknown) => Promise<unknown>>,
) {
  Object.assign(hostHandlers, handlers);
}
