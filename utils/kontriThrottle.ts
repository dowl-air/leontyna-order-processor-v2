// Kontri allows one request per 2000 ms; spacing is measured from the end of the previous response.
export const KONTRI_REQUEST_SPACING_MS = 2200;
// A hung request must not block other requests in the same instance indefinitely.
export const KONTRI_QUEUE_RELEASE_MS = 60_000;

let lastRequestEnd = 0;
let queue: Promise<unknown> = Promise.resolve();

export function withKontriSpacing<T>(request: () => Promise<T>): Promise<T> {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const run = queue.then(async () => {
        const wait = lastRequestEnd + KONTRI_REQUEST_SPACING_MS - Date.now();
        if (lastRequestEnd && wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        markStarted();
        try {
            return await request();
        } finally {
            lastRequestEnd = Date.now();
        }
    });
    // The next request waits for this one to settle, or at most KONTRI_QUEUE_RELEASE_MS after it started.
    queue = started.then(() => {
        let release: ReturnType<typeof setTimeout> | undefined;
        return Promise.race([
            run.catch(() => undefined),
            new Promise<void>((resolve) => {
                release = setTimeout(() => {
                    lastRequestEnd = Date.now();
                    resolve();
                }, KONTRI_QUEUE_RELEASE_MS);
            }),
        ]).finally(() => clearTimeout(release));
    });
    return run;
}

export function resetKontriSpacing() {
    lastRequestEnd = 0;
    queue = Promise.resolve();
}
