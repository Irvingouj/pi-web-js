import type { CellError as CellErrorType } from "./generated";

export type CellError = CellErrorType;

export interface WorkerRunResult {
  stdout: string[];
  stderr: string[];
  result: string | null;
  error: CellError | null;
  execution_count: number;
}
