declare global {
    interface Window {
        __jsNotebookSetLogLevel?: (level: string) => void;
        __jsNotebookContentScriptInjected?: boolean;
    }
}
export {};
