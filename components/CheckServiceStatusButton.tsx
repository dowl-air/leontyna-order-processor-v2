"use client";

import { useState } from "react";

import { checkServiceStatus } from "@/actions/checkServiceStatus";

const CheckServiceStatusButton = () => {
    const [status, setStatus] = useState<string>("");

    const onClick = async () => {
        const response = await checkServiceStatus();
        if (response.CheckStatusResult) {
            setStatus(response.CheckStatusResult);
        } else {
            setStatus("KontriAPI nyní není dostupné.");
        }
        setTimeout(() => {
            setStatus("");
        }, 5000);
    };

    return (
        <>
            <button className="btn btn-primary btn-outline btn-xs" onClick={onClick}>
                KontriAPI status
            </button>
            {status && (
                <div className="toast toast-primary toast-start z-10">
                    <div className={`alert ${status === "OK" ? "alert-success" : "alert-error"}`}>
                        <span>{status === "OK" ? "KontriAPI je dostupné." : "Chyba: " + status}</span>
                    </div>
                </div>
            )}
        </>
    );
};

export default CheckServiceStatusButton;
