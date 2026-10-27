"use server";

import { kontriMappingStore } from "@/db/kontriMapping";
import { KontriFeedDropError, refreshKontriMapping } from "@/utils/kontriFeed";
import { formatKontriError, logKontriError } from "@/utils/kontriDiagnostics";
import { sendMail } from "./sendMail";

async function notifyFeedError(message: string, phase: string) {
    logKontriError("feed", phase, { message });
    try {
        const result = await sendMail({
            subject: `[Kontri feed] ${phase}`,
            text: `${message}\nFáze: ${phase}\nČas: ${new Date().toISOString()}`,
        });
        if (result) return "";
    } catch {
        console.error("Kontri feed error notification failed.");
    }
    return " E-mailové upozornění se nepodařilo odeslat.";
}

async function feedError(message: string, phase: string) {
    return { status: "error", message: message + (await notifyFeedError(message, phase)) };
}

export async function downloadKontriFeed() {
    const login = process.env.KONTRI_FEED_LOGIN;
    const password = process.env.KONTRI_FEED_PASSWORD;
    if (!login || !password) return feedError("Chybí přihlašovací údaje ke Kontri feedu.", "Konfigurace");
    let phase = "Stažení";
    try {
        const response = await fetch("https://xml.kontri.pl/mobilhit/MobilHit_Products_3.0.xml", {
            headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}` },
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(45000),
        });
        if (!response.ok) return feedError(`Kontri feed vrátil HTTP ${response.status}.`, phase);
        const xml = await response.text();
        phase = "Ověření a uložení";
        if (Buffer.byteLength(xml) > 25 * 1024 * 1024) throw new Error("Feed exceeds size limit.");
        const result = await refreshKontriMapping(xml, kontriMappingStore);
        const cleanupMessage = `Úklid starých verzí selhal; mapování je dostupné.${result.cleanupError ? ` Chyba: ${result.cleanupError}` : ""}`;
        const notificationMessage = result.cleanupFailed ? await notifyFeedError(cleanupMessage, "Úklid") : "";
        const message = result.rejected
            ? "Stažené Kontri mapování nebylo aktivováno: publikace byla odmítnuta kvůli shodné nebo novější aktivní verzi. Aktivní mapování nebylo tímto během změněno."
            : `${result.unchanged ? "Kontri mapování je aktuální" : "Kontri mapování bylo uloženo"}: ${result.recordCount} variant.`;
        return {
            status: result.rejected ? "info" : "success",
            message: `${message}${result.cleanupFailed ? ` ${cleanupMessage}` : ""}${notificationMessage}`,
        };
    } catch (error) {
        if (error instanceof KontriFeedDropError) {
            return feedError(
                `Kontri feed byl odmítnut: počet variant klesl o více než 25 % (${error.previousCount} → ${error.incomingCount}). Původní mapování zůstává zachované.`,
                "Kontrola počtu variant",
            );
        }
        return feedError(
            `Stažení, ověření nebo uložení Kontri feedu selhalo. Původní mapování zůstává zachované. Fáze: ${phase}. Chyba: ${formatKontriError(error)}`,
            phase,
        );
    }
}
