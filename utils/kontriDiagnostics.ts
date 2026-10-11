function safeText(value: unknown): string {
    if (typeof value !== "string" && typeof value !== "number") return "[empty]";
    let text = String(value);
    const secrets = Object.entries(process.env)
        .filter(([key, secret]) => secret && /PASSWORD|SECRET|TOKEN|API_KEY|USERNAME|API_USER|FEED_LOGIN|SHOPTET_URL|GCP_SERVER_ADDRESS/.test(key))
        .map(([, secret]) => secret!);
    if (process.env.KONTRI_API_USER && process.env.KONTRI_API_PASSWORD)
        secrets.push(Buffer.from(`${process.env.KONTRI_API_USER}:${process.env.KONTRI_API_PASSWORD}`).toString("base64"));
    for (const secret of secrets.sort((first, second) => second.length - first.length)) text = text.split(secret).join("[redacted]");
    return (
        text
            .replace(/https?:\/\/[^\s<>"']+/gi, "[url]")
            .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
            .replace(/\b(Basic|Bearer)\s+\S+/gi, "$1 [redacted]")
            .replace(/[\r\n\t]/g, " ")
            .slice(0, 2000) || "[empty]"
    );
}

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function quantities(value: unknown): unknown {
    if (!Array.isArray(value)) return "[missing]";
    return value.map((item) => {
        const article = object(item);
        return {
            apiId: safeText(article.AltumArticleID),
            quantity: typeof article.Quantity === "number" ? article.Quantity : safeText(article.Quantity),
        };
    });
}

export function logKontriEvent(event: string, reference: string, details: Record<string, string | number | boolean> = {}) {
    console.info("Kontri diagnostic", { event, reference, ...details });
}

export function logKontriResponse(operation: string, reference: string, response: unknown) {
    const result = object(response);
    console.info("Kontri diagnostic", {
        event: `${operation}.response`,
        reference,
        code: typeof result.Code === "number" ? result.Code : safeText(result.Code),
        message: safeText(result.Message),
        orderId: safeText(result.AltumOrderID),
        status: safeText(result.Status),
        shortages: quantities(object(result.Shortages).Shortages),
        articles: quantities(object(result.Articles).Article),
    });
}

export function logKontriError(operation: string, reference: string, error: unknown) {
    const details = object(error);
    console.error("Kontri diagnostic", {
        event: `${operation}.error`,
        reference,
        errorCode: safeText(details.code),
        message: safeText(details.message),
    });
}
