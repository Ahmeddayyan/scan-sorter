/**
 * tesseract.js integration: one lazily created, module-wide scheduler (self-hosted assets),
 * reused across `processFiles` calls and terminated on cancel / shutdown.
 */
import type { OcrBlockLike } from './helpers';
import { resolveWorkerCount } from './helpers';

type TesseractModule = typeof import('tesseract.js');
type Scheduler = ReturnType<TesseractModule['createScheduler']>;
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>;

export interface OcrListener {
  /** Human-readable status ("Loading OCR engine…"). */
  onStatus?: (message: string) => void;
  /** Non-fatal worker errors. */
  onError?: (message: string) => void;
}

interface SchedulerState {
  scheduler: Scheduler;
  workers: number;
}

interface SchedulerEntry {
  promise: Promise<SchedulerState>;
  /** True once creation has succeeded or failed. */
  settled: boolean;
}

let current: SchedulerEntry | null = null;
const listeners = new Set<OcrListener>();

export function addOcrListener(listener: OcrListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitStatus(message: string): void {
  for (const l of listeners) l.onStatus?.(message);
}

function emitError(message: string): void {
  for (const l of listeners) l.onError?.(message);
}

async function loadTesseract(): Promise<TesseractModule> {
  const mod = await import('tesseract.js');
  // CommonJS interop: named exports may live on `default` depending on the bundler.
  const maybe = mod as unknown as { createWorker?: unknown; default?: TesseractModule };
  return typeof maybe.createWorker === 'function' ? mod : (maybe.default as TesseractModule);
}

function workerOptions(): Partial<import('tesseract.js').WorkerOptions> {
  const base = import.meta.env.BASE_URL;
  return {
    workerPath: `${base}tesseract/worker.min.js`,
    corePath: `${base}tesseract/core`,
    langPath: `${base}tesseract/lang`,
    gzip: true,
    workerBlobURL: true,
    logger: (m) => {
      if (m.status === 'recognizing text') return;
      emitStatus(`OCR: ${m.status}${m.progress > 0 && m.progress < 1 ? ` ${Math.round(m.progress * 100)}%` : ''}`);
    },
    errorHandler: (err) => {
      emitError(err instanceof Error ? err.message : String(err));
    },
  };
}

async function makeWorker(T: TesseractModule): Promise<TesseractWorker> {
  const oem = (T.OEM?.LSTM_ONLY ?? 1) as import('tesseract.js').OEM;
  const worker = await T.createWorker('eng', oem, workerOptions());
  await worker.setParameters({
    tessedit_pageseg_mode: (T.PSM?.SPARSE_TEXT ?? '11') as import('tesseract.js').PSM,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  return worker;
}

async function createState(requestedWorkers: number | undefined): Promise<SchedulerState> {
  const T = await loadTesseract();
  const count = resolveWorkerCount(requestedWorkers, typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency);
  const scheduler = T.createScheduler();
  const created: TesseractWorker[] = [];
  try {
    emitStatus('Loading OCR engine…');
    // The first worker downloads/caches the language data; the rest start in parallel afterwards.
    const first = await makeWorker(T);
    created.push(first);
    scheduler.addWorker(first);
    const rest = await Promise.all(Array.from({ length: count - 1 }, () => makeWorker(T)));
    for (const w of rest) {
      created.push(w);
      scheduler.addWorker(w);
    }
    emitStatus('OCR engine ready');
    return { scheduler, workers: count };
  } catch (error) {
    await Promise.allSettled(created.map((w) => w.terminate()));
    throw error;
  }
}

/** Scheduler + number of workers it has (an existing scheduler wins over `requestedWorkers`). */
export function getScheduler(requestedWorkers?: number): Promise<SchedulerState> {
  if (!current) {
    const entry: SchedulerEntry = { promise: Promise.resolve({ scheduler: null as never, workers: 0 }), settled: false };
    entry.promise = createState(requestedWorkers).then(
      (state) => {
        entry.settled = true;
        return state;
      },
      (error: unknown) => {
        entry.settled = true;
        if (current === entry) current = null;
        throw error;
      },
    );
    current = entry;
  }
  return current.promise;
}

/**
 * Terminate all OCR workers; in-flight jobs reject. A later `getScheduler` recreates them.
 * Workers that are still being created (first-time language download) are terminated as soon
 * as creation finishes - the caller is not kept waiting for that, so cancelling stays prompt.
 */
export async function terminateScheduler(): Promise<void> {
  const entry = current;
  current = null;
  if (!entry) return;
  const stopped = entry.promise.then((state) => state.scheduler.terminate()).catch(() => undefined);
  if (entry.settled) await stopped;
}

/** Recognise one image (a PNG Blob) and return the v7 `blocks` tree. */
export async function recognizeBlob(image: Blob): Promise<OcrBlockLike[]> {
  const { scheduler } = await getScheduler();
  const result = await scheduler.addJob(
    'recognize',
    image as unknown as string,
    {},
    { text: false, blocks: true },
  );
  return (result.data.blocks ?? []) as unknown as OcrBlockLike[];
}
