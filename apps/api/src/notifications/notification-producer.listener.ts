import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { WS_EVENTS, type MessageResponse } from "@relay/contracts";
import { Queue } from "bullmq";
import { FANOUT_JOB, NOTIFICATIONS_QUEUE, type FanoutJobData } from "./notifications.constants";

// Second subscriber to the same domain event the realtime gateway hears —
// the HTTP write path funds both without knowing either exists.
@Injectable()
export class NotificationProducerListener {
  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue<FanoutJobData>) {}

  @OnEvent(WS_EVENTS.messageCreated)
  async onMessageCreated(message: MessageResponse) {
    await this.queue.add(
      FANOUT_JOB,
      { messageId: message.id },
      // Deterministic jobId: a duplicate event for the same message can't
      // enqueue a second fan-out while the first is queued or running.
      // (BullMQ forbids ":" in custom ids — it's the Redis key delimiter.)
      { jobId: `fanout-${message.id}` },
    );
  }
}
