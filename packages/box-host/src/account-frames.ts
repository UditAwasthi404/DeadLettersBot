import { randomUUID } from "node:crypto";
import type { RedisClient, ServerFrame } from "@agentos/shared";
import { loggedError, logger } from "./logger.ts";

export interface AccountFrameTransport {
  attach(accountId: string, send: (frame: ServerFrame) => void): () => void;
  publish(accountId: string, frame: ServerFrame): void;
}

interface AccountFrameEnvelope {
  origin: string;
  frame: ServerFrame;
}

/** Redis fanout keeps account sockets live when another host owns their bot's turn. */
export class AccountFrameRouter implements AccountFrameTransport {
  private readonly hostId = `${process.env.HOSTNAME ?? "box-host"}:${randomUUID()}`;
  private readonly local = new Map<string, Set<(frame: ServerFrame) => void>>();
  private readonly subscriber: ReturnType<RedisClient["duplicate"]>;

  constructor(private readonly redis: RedisClient) {
    this.subscriber = redis.duplicate();
    this.subscriber.on("error", (err) =>
      logger.warn({ ...loggedError(err) }, "account frame subscriber error"),
    );
    this.subscriber.on("pmessage", (_pattern, channel, message) => {
      const accountId = channel.slice("account:frames:".length);
      let envelope: AccountFrameEnvelope;
      try {
        envelope = JSON.parse(message) as AccountFrameEnvelope;
      } catch {
        logger.warn({ channel }, "discarded malformed account frame event");
        return;
      }
      if (envelope.origin === this.hostId || !envelope.frame) return;
      this.sendLocal(accountId, envelope.frame);
    });
  }

  async start(): Promise<void> {
    await this.subscriber.psubscribe("account:frames:*");
  }

  attach(accountId: string, send: (frame: ServerFrame) => void): () => void {
    let connections = this.local.get(accountId);
    if (!connections) {
      connections = new Set();
      this.local.set(accountId, connections);
    }
    connections.add(send);
    return () => {
      connections?.delete(send);
      if (connections?.size === 0) this.local.delete(accountId);
    };
  }

  publish(accountId: string, frame: ServerFrame): void {
    this.sendLocal(accountId, frame);
    const envelope: AccountFrameEnvelope = { origin: this.hostId, frame };
    void this.redis
      .publish(`account:frames:${accountId}`, JSON.stringify(envelope))
      .catch((err) =>
        logger.warn({ ...loggedError(err), accountId }, "account frame fanout failed"),
      );
  }

  private sendLocal(accountId: string, frame: ServerFrame): void {
    for (const send of this.local.get(accountId) ?? []) {
      try {
        send(frame);
      } catch (err) {
        logger.warn({ ...loggedError(err), accountId }, "local account frame delivery failed");
      }
    }
  }
}
