import { collection, doc, getDoc, getDocs, getFirestore, runTransaction, writeBatch } from "firebase/firestore";
import { assertKontriMappingCount, KontriMappingStore, KontriMappingVersion } from "@/utils/kontriFeed";
import { db } from "./init";

const mappingDb = getFirestore(db.app);
const pointer = doc(mappingDb, "kontriMappingState", "current");
const versions = collection(mappingDb, "kontriMappings");

export const kontriMappingStore: KontriMappingStore = {
    async current() {
        const snapshot = await getDoc(pointer);
        return snapshot.exists() ? { hash: snapshot.data().hash as string, recordCount: snapshot.data().recordCount as number } : null;
    },
    async save(metadata, chunks) {
        const version = doc(versions, metadata.version);
        for (let offset = 0; offset < chunks.length; offset += 400) {
            const batch = writeBatch(mappingDb);
            chunks.slice(offset, offset + 400).forEach((data, index) => {
                batch.set(doc(collection(version, "chunks"), String(offset + index)), { data });
            });
            batch.set(version, metadata);
            await batch.commit();
        }
    },
    async publish(metadata) {
        return runTransaction(mappingDb, async (transaction) => {
            const snapshot = await transaction.get(pointer);
            const current = snapshot.data();
            if (
                current?.hash === metadata.hash ||
                current?.fetchedAt >= metadata.fetchedAt ||
                (current?.feedDate && current.feedDate > metadata.feedDate)
            )
                return false;
            if (current) assertKontriMappingCount(current.recordCount, metadata.recordCount);
            transaction.set(pointer, { ...metadata, previousVersion: current?.version ?? null });
            return true;
        });
    },
    async cleanup() {
        const state = (await getDoc(pointer)).data();
        if (!state) return;
        const snapshots = await getDocs(versions);
        for (const snapshot of snapshots.docs) {
            const metadata = snapshot.data() as KontriMappingVersion;
            if (snapshot.id === state.version || snapshot.id === state.previousVersion || metadata.fetchedAt > Date.now() - 48 * 60 * 60 * 1000)
                continue;
            const chunks = await getDocs(collection(snapshot.ref, "chunks"));
            for (let offset = 0; offset < chunks.docs.length; offset += 400) {
                const batch = writeBatch(mappingDb);
                chunks.docs.slice(offset, offset + 400).forEach((chunk) => batch.delete(chunk.ref));
                await batch.commit();
            }
            const batch = writeBatch(mappingDb);
            batch.delete(snapshot.ref);
            await batch.commit();
        }
    },
};
