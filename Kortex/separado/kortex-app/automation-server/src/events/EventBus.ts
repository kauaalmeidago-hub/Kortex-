import { EventEmitter } from "node:events";
import type { OperationEvent } from "../types.js";

export class OperationEventBus {
  private readonly emitter = new EventEmitter();

  publish(event: OperationEvent) {
    this.emitter.emit(event.operationId, event);
  }

  subscribe(operationId: string, listener: (event: OperationEvent) => void) {
    this.emitter.on(operationId, listener);
    return () => {
      this.emitter.off(operationId, listener);
    };
  }
}
