"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, SearchCheck, X } from "lucide-react";
import { previewKontriMapping } from "@/actions/previewKontriMapping";
import type { KontriMappingPreview } from "@/actions/previewKontriMapping";

const reasons = {
    invalidCode: "Neplatný kód produktu",
    notFound: "Nenalezeno v aktivní cache",
    eanMismatch: "ID a EAN označují různé produkty",
    ambiguous: "Nejednoznačná shoda",
};
const sources = { catalogId: "Katalogové ID", apiId: "API ID", ean: "EAN" };
const PAGE_SIZE = 50;

export function KontriMappingPreviewButton() {
    const dialog = useRef<HTMLDialogElement>(null);
    const [loading, setLoading] = useState(false);
    const [preview, setPreview] = useState<KontriMappingPreview | null>(null);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [blockedOnly, setBlockedOnly] = useState(false);
    const [page, setPage] = useState(0);

    const loadPreview = async () => {
        dialog.current?.showModal();
        setLoading(true);
        setError("");
        setPreview(null);
        setPage(0);
        try {
            const result = await previewKontriMapping();
            if (result.status === "error") setError(result.message);
            else setPreview(result);
        } catch {
            setError("Náhled párování se nepodařilo načíst.");
        } finally {
            setLoading(false);
        }
    };

    const query = search.trim().toLocaleLowerCase();
    const rows = (preview?.rows ?? []).filter(
        (row) =>
            (!blockedOnly || row.resolution.status === "blocked") &&
            [row.code, row.orderItemCode, row.orderItemEan, row.orderItemName, row.resolution.status === "matched" ? row.resolution.apiId : ""].some(
                (value) => value.toLocaleLowerCase().includes(query),
            ),
    );
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

    return (
        <>
            <button className="btn btn-sm md:btn-md btn-outline btn-primary whitespace-normal" disabled={loading} onClick={loadPreview}>
                <SearchCheck size={18} aria-hidden="true" /> Náhled párování
            </button>
            <dialog ref={dialog} className="modal">
                <div className="modal-box rounded-lg w-[calc(100%-2rem)] max-w-6xl max-h-[90dvh] flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="font-bold text-lg">Párování Kontri produktů</h3>
                        <div className="flex gap-2 shrink-0">
                            <button
                                className="btn btn-sm btn-square btn-ghost"
                                title="Obnovit náhled"
                                aria-label="Obnovit náhled"
                                disabled={loading}
                                onClick={loadPreview}
                            >
                                <RefreshCw size={18} />
                            </button>
                            <button
                                className="btn btn-sm btn-square btn-ghost"
                                title="Zavřít"
                                aria-label="Zavřít"
                                onClick={() => dialog.current?.close()}
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </div>
                    {loading && (
                        <div role="status" className="py-8 text-center">
                            <span className="loading loading-spinner" /> Načítání…
                        </div>
                    )}
                    {error && (
                        <div role="alert" className="alert alert-error rounded-lg">
                            {error}
                        </div>
                    )}
                    {preview && (
                        <>
                            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                                <span>
                                    Položky: <strong>{preview.rows.length}</strong>
                                </span>
                                <span>
                                    Spárováno: <strong>{preview.matchedCount}</strong>
                                </span>
                                <span>
                                    Blokováno: <strong>{preview.blockedCount}</strong>
                                </span>
                            </div>
                            {preview.version && <div className="text-xs break-all text-base-content/70">Verze cache: {preview.version}</div>}
                            <div className="flex flex-wrap items-center gap-3">
                                <input
                                    aria-label="Hledat v párování"
                                    className="input input-bordered input-sm w-full sm:w-72"
                                    placeholder="Objednávka, kód, EAN, API ID"
                                    value={search}
                                    onChange={(event) => {
                                        setSearch(event.target.value);
                                        setPage(0);
                                    }}
                                />
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        className="checkbox checkbox-sm"
                                        checked={blockedOnly}
                                        onChange={(event) => {
                                            setBlockedOnly(event.target.checked);
                                            setPage(0);
                                        }}
                                    />{" "}
                                    Pouze blokované
                                </label>
                            </div>
                            <div className="overflow-auto min-h-0">
                                <table className="table table-sm table-zebra">
                                    <thead>
                                        <tr>
                                            <th>Objednávka</th>
                                            <th>Produkt</th>
                                            <th>Původní kód</th>
                                            <th>EAN</th>
                                            <th>Počet</th>
                                            <th>API ID</th>
                                            <th>Výsledek</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row) => (
                                            <tr key={row.fID}>
                                                <td className="whitespace-nowrap">{row.code}</td>
                                                <td className="min-w-40 max-w-72 break-words">{row.orderItemName}</td>
                                                <td className="whitespace-nowrap">{row.orderItemCode}</td>
                                                <td className="whitespace-nowrap">{row.orderItemEan || "-"}</td>
                                                <td>{row.orderItemAmount}</td>
                                                <td>{row.resolution.status === "matched" ? row.resolution.apiId : "-"}</td>
                                                <td className={row.resolution.status === "blocked" ? "text-error min-w-48" : "min-w-40"}>
                                                    {row.resolution.status === "matched"
                                                        ? `Shoda: ${sources[row.resolution.source]}`
                                                        : reasons[row.resolution.reason]}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {!rows.length && (
                                    <p className="text-center py-6">
                                        {preview.rows.length ? "Žádné odpovídající položky." : "Žádné čekající produkty."}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center justify-between gap-3 text-sm">
                                <span>{rows.length} položek</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        className="btn btn-sm btn-square btn-ghost"
                                        title="Předchozí strana"
                                        aria-label="Předchozí strana"
                                        disabled={page === 0}
                                        onClick={() => setPage(page - 1)}
                                    >
                                        <ChevronLeft size={18} />
                                    </button>
                                    <span>
                                        {page + 1} / {pages}
                                    </span>
                                    <button
                                        className="btn btn-sm btn-square btn-ghost"
                                        title="Další strana"
                                        aria-label="Další strana"
                                        disabled={page + 1 >= pages}
                                        onClick={() => setPage(page + 1)}
                                    >
                                        <ChevronRight size={18} />
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
                <form method="dialog" className="modal-backdrop">
                    <button aria-label="Zavřít náhled">close</button>
                </form>
            </dialog>
        </>
    );
}
