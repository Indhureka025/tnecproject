export interface Job<T> {
  id: string;
  payload: T;
  attempt: number;
}

export interface Queue<T> {
  /** enqueue a job; optional delay in ms */
  add(payload: T, opts?: { delayMs?: number }): Promise<string>;
  /** register the single worker for this queue */
  process(handler: (job: Job<T>) => Promise<void>): void;
  /** graceful drain (tests) */
  close(): Promise<void>;
}
