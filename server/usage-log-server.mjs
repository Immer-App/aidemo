import { mkdir, appendFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 8787);
const logDir = path.join(__dirname, "logs");
const logFile = path.join(logDir, "usage.ndjson");

const send = (response, statusCode, body) => {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(body));
};

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    send(response, 400, { error: "Missing URL" });
    return;
  }

  if (request.method === "OPTIONS") {
    send(response, 204, {});
    return;
  }

  if (request.method !== "POST" || request.url !== "/api/usage") {
    send(response, 404, { error: "Not found" });
    return;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  try {
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const payload = JSON.parse(rawBody);
    await mkdir(logDir, { recursive: true });
    await appendFile(
      logFile,
      `${JSON.stringify({
        receivedAt: new Date().toISOString(),
        ...payload
      })}\n`,
      "utf8"
    );
    send(response, 204, {});
  } catch (error) {
    send(response, 400, {
      error: error instanceof Error ? error.message : "Invalid payload"
    });
  }
});

server.listen(port, () => {
  console.log(`Usage log server listening on http://localhost:${port}`);
  console.log(`Appending usage events to ${logFile}`);
});
