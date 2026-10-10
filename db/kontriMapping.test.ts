import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ current: {} as Record<string, unknown>, set: vi.fn(), commit: vi.fn(), getDocs: vi.fn(), remove: vi.fn() }));
vi.mock("./init", () => ({ db: { app: {} } }));
vi.mock("firebase/firestore", () => ({
    getFirestore: () => ({}),
    collection: (...parts: unknown[]) => parts,
    doc: (...parts: unknown[]) => parts,
    getDoc: async () => ({ exists: () => true, data: () => mocks.current }),
    getDocs: mocks.getDocs,
    runTransaction: async (_database: unknown, callback: (transaction: unknown) => unknown) =>
        callback({ get: async () => ({ data: () => mocks.current }), set: mocks.set }),
    writeBatch: () => ({ set: mocks.set, commit: mocks.commit, delete: mocks.remove }),
}));
import { kontriMappingStore } from "./kontriMapping";

const metadata = { version: "new", hash: "new-hash", feedDate: "2026-10-10 12:24", fetchedAt: 10, recordCount: 1, chunkCount: 1 };

describe("Kontri Firestore mapping", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.current = {};
        mocks.commit.mockResolvedValue(undefined);
    });
    it("publishes metadata and retains the previous version", async () => {
        mocks.current = { version: "old", fetchedAt: 1 };
        expect(await kontriMappingStore.publish(metadata)).toBe(true);
        expect(mocks.set).toHaveBeenCalledWith(expect.anything(), { ...metadata, previousVersion: "old" });
    });
    it.each([{ hash: "new-hash" }, { fetchedAt: 11 }, { feedDate: "2026-10-11 12:24" }])(
        "does not overwrite newer or identical state",
        async (state) => {
            mocks.current = state;
            expect(await kontriMappingStore.publish(metadata)).toBe(false);
            expect(mocks.set).not.toHaveBeenCalled();
        },
    );
    it("stores chunks and metadata in a batch", async () => {
        await kontriMappingStore.save(metadata, ["[]"]);
        expect(mocks.set).toHaveBeenCalledTimes(2);
        expect(mocks.commit).toHaveBeenCalledOnce();
    });
    it("reads the active record count", async () => {
        mocks.current = { hash: "old-hash", recordCount: 4 };
        expect(await kontriMappingStore.current()).toEqual({ hash: "old-hash", recordCount: 4 });
    });
    it("rejects a drop against the current count inside the publication transaction", async () => {
        mocks.current = { version: "concurrent", fetchedAt: 1, recordCount: 2 };
        await expect(kontriMappingStore.publish(metadata)).rejects.toMatchObject({ previousCount: 2, incomingCount: 1 });
        expect(mocks.set).not.toHaveBeenCalled();
    });
    it("allows exactly a 25 percent drop inside the publication transaction", async () => {
        mocks.current = { version: "old", fetchedAt: 1, recordCount: 4 };
        expect(await kontriMappingStore.publish({ ...metadata, recordCount: 3 })).toBe(true);
    });
    it("protects active, previous and recent versions during cleanup", async () => {
        mocks.current = { version: "active", previousVersion: "previous" };
        mocks.getDocs
            .mockResolvedValueOnce({
                docs: [
                    { id: "active", data: () => ({ fetchedAt: 0 }) },
                    { id: "previous", data: () => ({ fetchedAt: 0 }) },
                    { id: "recent", data: () => ({ fetchedAt: Date.now() }) },
                    { id: "expired", ref: "expired-ref", data: () => ({ fetchedAt: 0 }) },
                ],
            })
            .mockResolvedValueOnce({ docs: [{ ref: "expired-chunk" }] });
        await kontriMappingStore.cleanup();
        expect(mocks.remove.mock.calls).toEqual([["expired-chunk"], ["expired-ref"]]);
    });
});
