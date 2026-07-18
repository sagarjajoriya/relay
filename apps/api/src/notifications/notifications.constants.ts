export const NOTIFICATIONS_QUEUE = "notifications";
export const FANOUT_JOB = "message.fanout";

export interface FanoutJobData {
  // IDs only — the worker re-reads authoritative state at processing time, so
  // a message deleted between enqueue and process is simply skipped, and the
  // Redis payload stays tiny.
  messageId: string;
}
