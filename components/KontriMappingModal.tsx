"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, RefreshCw, TriangleAlert, X } from "lucide-react";
import { getKontriProductMapping, type KontriProductMappingResult } from "@/actions/getKontriProductMapping";
import type ShopOrder from "@/types/ShopOrder";

export const KontriMappingModal = ({ product, onClose }: { product: ShopOrder; onClose: () => void }) => {
    const dialog = useRef<HTMLDialogElement>(null);
    const [result, setResult] = useState<KontriProductMappingResult | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        dialog.current?.showModal();
    }, []);

    useEffect(() => {
        let active = true;
        setResult(null);
        getKontriProductMapping(product.orderItemCode)
            .then((response) => {
                if (active) setResult(response);
            })
            .catch(() => {
                if (active) setResult({ status: "error" });
            });
        return () => {
            active = false;
        };
    }, [product.orderItemCode, attempt]);

    const mapping = result && "record" in result ? result : null;
    const record = mapping?.record;
    const sourceEan = String(product.orderItemEan ?? "").trim();
    const eanMatches = !!sourceEan && !!record && sourceEan === record.ean;
    const eanColor = eanMatches ? "text-green-700 dark:text-green-400" : "text-orange-700 dark:text-orange-400";
    const errorMessage =
        result?.status === "error"
            ? "Mapování se nepodařilo načíst."
            : result?.status === "invalidCode"
              ? "Kód produktu nemá platný formát katalogového ID."
              : result?.status === "notFound"
                ? "Katalogové ID nebylo v aktivním feedu nalezeno."
                : result?.status === "ambiguous"
                  ? "Katalogové ID má více mapování; nelze vybrat jednu položku."
                  : null;

    return (
        <dialog
            ref={dialog}
            className="modal modal-bottom sm:modal-middle"
            aria-labelledby="kontri-mapping-title"
            onCancel={onClose}
            onClose={onClose}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    onClose();
                }
            }}
        >
            <div className="modal-box rounded-lg w-[calc(100%-2rem)] max-w-xl">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 id="kontri-mapping-title" className="font-bold text-lg">
                            Kontri mapování
                        </h3>
                        <p className="break-words">{product.orderItemCode}</p>
                        <p className="text-sm text-base-content/70 break-words">{product.orderItemName}</p>
                    </div>
                    <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-square shrink-0"
                        aria-label="Zavřít mapování"
                        title="Zavřít mapování"
                        onClick={onClose}
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>
                {!result ? (
                    <div role="status" className="flex justify-center items-center gap-2 py-8">
                        <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                        Načítání mapování
                    </div>
                ) : (
                    <div className="mt-4">
                        {errorMessage && (
                            <p role="alert" className="text-orange-700 dark:text-orange-400 mb-3">
                                {errorMessage}
                            </p>
                        )}
                        {mapping && (
                            <>
                                {record && (
                                    <p className={`flex items-center gap-2 font-semibold mb-2 ${eanColor}`}>
                                        {eanMatches ? <CheckCircle2 size={18} aria-hidden="true" /> : <TriangleAlert size={18} aria-hidden="true" />}
                                        {eanMatches ? "Shoda EAN" : sourceEan ? "Nesoulad EAN" : "EAN nelze porovnat"}
                                    </p>
                                )}
                                <div className="overflow-x-auto">
                                    <table className="table table-sm">
                                        <thead>
                                            <tr>
                                                <th></th>
                                                <th>Shoptet</th>
                                                <th>Kontri</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr className={record ? eanColor : undefined}>
                                                <th>EAN</th>
                                                <td className="break-all">{sourceEan || "Neuvedeno"}</td>
                                                <td className="break-all">{record?.ean ?? "Nenalezeno"}</td>
                                            </tr>
                                            <tr>
                                                <th className="[overflow-wrap:anywhere]">id_instancji</th>
                                                <td>{mapping.itemId}</td>
                                                <td>{record?.catalogId ?? "Nenalezeno"}</td>
                                            </tr>
                                            <tr>
                                                <th className="[overflow-wrap:anywhere]">
                                                    id_instancji_API
                                                    <br />
                                                    <span className="font-normal">Kód pro objednání</span>
                                                </th>
                                                <td></td>
                                                <td>{record?.apiId ?? "Nenalezeno"}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <dl className="mt-4 text-sm grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
                                    <dt className="font-semibold">Aktuální feed</dt>
                                    <dd></dd>
                                    <dt>Verze</dt>
                                    <dd className="break-all">{mapping.version}</dd>
                                    <dt>Datum feedu</dt>
                                    <dd className="break-words">{mapping.feedDate ?? "Neuvedeno"}</dd>
                                    {product.kontriApiId && (
                                        <>
                                            <dt>Uložené API ID</dt>
                                            <dd>{product.kontriApiId}</dd>
                                        </>
                                    )}
                                </dl>
                            </>
                        )}
                        {result.status === "error" && (
                            <button
                                type="button"
                                className="btn btn-sm btn-ghost btn-square"
                                aria-label="Znovu načíst mapování"
                                title="Znovu načíst mapování"
                                onClick={() => setAttempt((previous) => previous + 1)}
                            >
                                <RefreshCw size={18} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </dialog>
    );
};
