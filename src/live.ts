// STUDENT NAME, STUDENT NUMBER
// Bonus 13: push task changes to the open browser tabs of the same user.
import type { Task } from "./schema.ts";

export type LiveEvent = {
  type: "created" | "updated" | "deleted" | "restored";
  task: Task;
};

/** The part of a WebSocket the hub needs; tests use a fake one. */
export type LiveSocket = { send(data: string): void; readyState: number };

const OPEN = 1;

export class LiveHub {
  #byUser = new Map<number, Set<LiveSocket>>();

  add(userId: number, socket: LiveSocket): void {
    let set = this.#byUser.get(userId);
    if (!set) this.#byUser.set(userId, set = new Set());
    set.add(socket);
  }

  remove(userId: number, socket: LiveSocket): void {
    const set = this.#byUser.get(userId);
    set?.delete(socket);
    if (set && set.size === 0) this.#byUser.delete(userId);
  }

  /** Send to that user's sockets only, never to everyone. Returns how many got it. */
  publish(userId: number, event: LiveEvent): number {
    const data = JSON.stringify(event);
    let sent = 0;
    for (const socket of this.#byUser.get(userId) ?? []) {
      if (socket.readyState !== OPEN) continue;
      socket.send(data);
      sent++;
    }
    return sent;
  }

  count(userId: number): number {
    return this.#byUser.get(userId)?.size ?? 0;
  }
}
