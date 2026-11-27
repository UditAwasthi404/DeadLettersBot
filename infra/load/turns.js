/**
 * k6 load script for mock-inference WebSocket turns (Phase 4 Track E).
 *
 * Prerequisites:
 *   - Compose stack with INFERENCE_MOCK=1
 *   - BOOTSTRAP_TOKEN and BOT_ID exported, or pass via k6 -e
 *
 * Example:
 *   k6 run -e BASE_URL=http://127.0.0.1:8787 -e TOKEN=$TOKEN -e BOT_ID=$BOT_ID \
 *     -e VUS=100 -e STEPS=5 infra/load/turns.js
 */
import { check, sleep } from "k6";
import ws from "k6/ws";
import { Counter, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:8787";
const TOKEN = __ENV.TOKEN || "";
const BOT_ID = __ENV.BOT_ID || "";
const STEPS = Number(__ENV.STEPS || 5);
const VUS = Number(__ENV.VUS || 100);

export const options = {
  vus: VUS,
  duration: __ENV.DURATION || "60s",
  thresholds: {
    turn_settled_ms: ["p(95)<10000"],
    checks: ["rate>0.95"],
  },
};

const turnLatency = new Trend("turn_settled_ms", true);
const settled = new Counter("turns_settled");
const failed = new Counter("turns_failed");

export default function () {
  if (!TOKEN || !BOT_ID) {
    failed.add(1);
    throw new Error("TOKEN and BOT_ID environment variables are required");
  }

  const wsUrl = BASE_URL.replace(/^http/, "ws") + "/ws";
  const started = Date.now();
  let sawAccepted = false;
  let sawSettled = false;

  const response = ws.connect(
    wsUrl,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    function (socket) {
      socket.on("open", () => {
        socket.send(
          JSON.stringify({
            type: "sendPrompt",
            agentId: BOT_ID,
            nonce: `${__VU}-${__ITER}-${Date.now()}`,
            prompt: `load-test turn steps=${STEPS} vu=${__VU}`,
            attachments: [],
          }),
        );
      });

      socket.on("message", (data) => {
        let frame;
        try {
          frame = JSON.parse(String(data));
        } catch {
          return;
        }
        if (frame.type === "accepted") sawAccepted = true;
        if (frame.type === "settled") {
          sawSettled = true;
          turnLatency.add(Date.now() - started);
          settled.add(1);
          socket.close();
        }
        if (frame.type === "error") {
          failed.add(1);
          socket.close();
        }
      });

      socket.setTimeout(() => {
        if (!sawSettled) failed.add(1);
        socket.close();
      }, 20_000);
    },
  );

  check(response, {
    "websocket status 101": (r) => r && r.status === 101,
    accepted: () => sawAccepted,
    settled: () => sawSettled,
  });
  sleep(0.2);
}
