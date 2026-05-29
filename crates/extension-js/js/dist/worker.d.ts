export type WorkerMessage = {
    type: "runCell";
    id: string;
    code: string;
    stdin: string;
} | {
    type: "reset";
    id: string;
} | {
    type: "stop";
    id: string;
} | {
    type: "setFuelLimit";
    id?: string;
    limit: number;
} | {
    type: "inspectGlobals";
    id: string;
} | {
    type: "loadLibrary";
    id: string;
    source: string;
} | {
    type: "setLogLevel";
    level: number;
} | {
    type: "asyncRelayResult";
    id: string;
    result: unknown;
};
