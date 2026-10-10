import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("SOAP URL parsing", () => {
    it("loads WSDL and calls SOAP with Basic Auth without legacy parsing", () => {
        const result = spawnSync(
            process.execPath,
            [
                "--pending-deprecation",
                "--trace-deprecation",
                "-e",
                `
            const url = require("node:url");
            url.parse = () => { throw new Error("Deprecated url.parse called"); };
            const http = require("node:http");
            const fs = require("node:fs");
            const soap = require("soap");
            const authorization = "Basic " + Buffer.from("test-user:test-password").toString("base64");
            let calls = 0;
            const server = http.createServer((req, res) => {
                if (req.headers.authorization !== authorization) {
                    res.writeHead(401); res.end(); return;
                }
                calls++;
                res.setHeader("Content-Type", "text/xml");
                if (req.method === "GET") {
                    const endpoint = "http://127.0.0.1:" + server.address().port + "/service";
                    res.end(fs.readFileSync("utils/fixtures/transport.wsdl", "utf8").replace("__ENDPOINT__", endpoint));
                } else {
                    req.resume();
                    res.end('<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><CheckStatusResponse xmlns="urn:transport-test"><Code>200</Code></CheckStatusResponse></soap:Body></soap:Envelope>');
                }
            });
            server.listen(0, "127.0.0.1", async () => {
                try {
                    const client = await soap.createClientAsync("http://127.0.0.1:" + server.address().port + "/service?wsdl", { wsdl_headers: { Authorization: authorization } });
                    client.setSecurity(new soap.BasicAuthSecurity("test-user", "test-password"));
                    const [response] = await client.CheckStatusAsync({});
                    if (response.Code !== 200 || calls !== 2) throw new Error("SOAP contract changed");
                } catch (error) {
                    console.error(error); process.exitCode = 1;
                } finally {
                    server.closeAllConnections(); server.close();
                }
            });
        `,
            ],
            { encoding: "utf8", timeout: 10000 },
        );
        expect(result.error).toBeUndefined();
        expect(result.stderr).not.toContain("DEP0169");
        expect(result.status, result.stderr).toBe(0);
    });
    it("builds requests without deprecated url.parse calls", () => {
        const result = spawnSync(
            process.execPath,
            [
                "--pending-deprecation",
                "--trace-deprecation",
                "-e",
                `
            const url = require("node:url");
            url.parse = () => { throw new Error("Deprecated url.parse called"); };
            const { HttpClient } = require("soap");
            const request = new HttpClient().buildRequest("https://example.test:8866/service?wsdl", null, {});
            if (request.url !== "https://example.test:8866/service?wsdl") throw new Error("URL changed");
        `,
            ],
            { encoding: "utf8" },
        );
        expect(result.stderr).not.toContain("Deprecated url.parse called");
        expect(result.stderr).not.toContain("DEP0169");
        expect(result.status).toBe(0);
    });
});
