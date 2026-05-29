export declare function setRunnerAbortController(controller: AbortController | null): void;
declare global {
    interface Window {
        __hostHandlers?: Record<string, HostHandler>;
    }
}
type HostHandler<T = unknown, R = unknown> = (params: T) => Promise<R>;
export interface Command {
    action: string;
    params: unknown;
}
type AsyncError = {
    message: string;
    code: string;
    category?: string;
};
type AsyncResponse<T = unknown> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: AsyncError;
};
export declare function registerHostHandler<T, R>(action: string, handler: (params: T) => Promise<R>): void;
export declare function registerHostHandlers(handlers: Record<string, HostHandler>): void;
export declare function executeMainThreadCommand(command: Command): Promise<AsyncResponse>;
export declare function getActiveTabId(): number | null;
export declare function initExtensionListeners(): void;
export declare function removeExtensionListeners(): void;
export {};
