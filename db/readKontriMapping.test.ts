import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn() }));
vi.mock("./init", () => ({ db: { app: {} } }));
vi.mock("firebase/firestore", () => ({
    getFirestore: () => ({}),
    doc: (...parts: unknown[]) => parts,
    collection: (...parts: unknown[]) => parts,
    getDoc: mocks.getDoc,
    getDocs: mocks.getDocs,
}));
import { readKontriMapping } from "./readKontriMapping";

const records = [{ catalogId: "1", apiId: "2", ean: "00123" }];
const metadata = { version: "active", chunkCount: 1, recordCount: 1, hash: createHash("sha256").update(JSON.stringify(records)).digest("hex") };
const chunk = (id = "0", data = JSON.stringify(records)) => ({ id, data: () => ({ data }) });

describe("readKontriMapping", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => metadata });
        mocks.getDocs.mockResolvedValue({ docs: [chunk()] });
    });
    it("reads the pointer once and loads only its version", async () => {
        expect(await readKontriMapping()).toEqual({ version: "active", feedDate: null, records });
        expect(mocks.getDoc).toHaveBeenCalledOnce();
        expect(mocks.getDocs).toHaveBeenCalledWith([{}, "kontriMappings", "active", "chunks"]);
    });
    it("returns the feed date from the same active pointer as the records", async () => {
        mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ ...metadata, feedDate: "2026-10-11 05:55" }) });
        expect(await readKontriMapping()).toEqual({ version: "active", feedDate: "2026-10-11 05:55", records });
        expect(mocks.getDoc).toHaveBeenCalledOnce();
    });
    it("rejects a missing active pointer", async () => {
        mocks.getDoc.mockResolvedValue({ exists: () => false });
        await expect(readKontriMapping()).rejects.toThrow();
        expect(mocks.getDocs).not.toHaveBeenCalled();
    });
    it.each([
        { name: "missing chunks", docs: [] },
        { name: "missing index", docs: [chunk("1")] },
        { name: "invalid JSON", docs: [chunk("0", "invalid")] },
        { name: "wrong count", docs: [chunk("0", "[]")] },
        { name: "incomplete record", docs: [chunk("0", '[{"catalogId":"1"}]')] },
    ])("rejects $name", async ({ docs }) => {
        mocks.getDocs.mockResolvedValue({ docs });
        await expect(readKontriMapping()).rejects.toThrow();
    });
    it("rejects a content hash mismatch", async () => {
        mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ ...metadata, hash: "wrong" }) });
        await expect(readKontriMapping()).rejects.toThrow();
    });
});
