import { fork, type ChildProcess } from "node:child_process";

export interface ServiceDefinition {
  name: string;
  entry: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface ServiceState {
  name: string;
  state: "starting" | "running" | "restarting" | "stopped";
  pid?: number;
  restarts: number;
  exitCode?: number | null;
  nextRestartAt?: string;
}

interface ManagedService {
  definition: ServiceDefinition;
  state: ServiceState;
  child?: ChildProcess;
  timer?: NodeJS.Timeout;
  failures: number;
  startedAt: number;
}

/** Owns only the children it starts. A restart never re-enqueues an operation. */
export class ProcessSupervisor {
  private stopping = false;
  private stopPromise?: Promise<void>;
  private readonly services: ManagedService[];

  constructor(definitions: ServiceDefinition[], private readonly options: {
    onChange?: (states: ServiceState[]) => void;
    minRestartMs?: number;
    maxRestartMs?: number;
    stableAfterMs?: number;
    shutdownTimeoutMs?: number;
  } = {}) {
    this.services = definitions.map((definition) => ({ definition,
      state: { name: definition.name, state: "stopped", restarts: 0 }, failures: 0, startedAt: 0 }));
  }

  snapshot(): ServiceState[] {
    return this.services.map((service) => ({ ...service.state }));
  }

  start() {
    if (this.stopping) throw new Error("Supervisor encerrado.");
    for (const service of this.services) {
      if (!service.child && !service.timer) this.launch(service);
    }
  }

  stop(): Promise<void> {
    return this.stopPromise ??= this.stopOwnedChildren();
  }

  private changed() {
    this.options.onChange?.(this.snapshot());
  }

  private launch(service: ManagedService) {
    if (this.stopping) return;
    service.state = { ...service.state, state: "starting", pid: undefined, nextRestartAt: undefined };
    this.changed();
    let finished = false;
    const ended = (code: number | null) => {
      if (finished) return;
      finished = true;
      service.child = undefined;
      service.state.pid = undefined;
      service.state.exitCode = code;
      if (this.stopping) {
        service.state.state = "stopped";
        this.changed();
        return;
      }
      if (Date.now() - service.startedAt >= (this.options.stableAfterMs ?? 60_000)) service.failures = 0;
      service.failures += 1;
      service.state.restarts += 1;
      const delay = Math.min(this.options.maxRestartMs ?? 30_000,
        (this.options.minRestartMs ?? 1000) * 2 ** Math.min(service.failures - 1, 10));
      service.state.state = "restarting";
      service.state.nextRestartAt = new Date(Date.now() + delay).toISOString();
      service.timer = setTimeout(() => {
        service.timer = undefined;
        this.launch(service);
      }, delay);
      this.changed();
    };
    service.startedAt = Date.now();
    try {
      // Do not inherit --inspect, test flags, shell quoting, or unredacted child logs.
      const child = fork(service.definition.entry, [], { cwd: service.definition.cwd,
        env: service.definition.env ?? process.env, execPath: process.execPath, execArgv: [],
        stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true });
      service.child = child;
      child.once("spawn", () => {
        service.state.pid = child.pid;
        this.changed();
      });
      child.on("message", (message) => {
        if (message === "ready" && !finished && !this.stopping) {
          service.state.state = "running";
          this.changed();
        }
      });
      child.once("error", () => { if (!child.pid) ended(null); else child.kill("SIGKILL"); });
      child.once("exit", ended);
    } catch {
      ended(null);
    }
  }

  private async stopOwnedChildren() {
    this.stopping = true;
    await Promise.all(this.services.map(async (service) => {
      if (service.timer) clearTimeout(service.timer);
      service.timer = undefined;
      const child = service.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          let timer: NodeJS.Timeout;
          const finished = () => { clearTimeout(timer); resolve(); };
          child.once("exit", finished);
          timer = setTimeout(() => {
            // Never kill a PID read from a file or another worker/Chrome instance.
            child.kill("SIGKILL");
          }, this.options.shutdownTimeoutMs ?? 20_000);
          if (child.connected) child.send("shutdown", (error) => { if (error) child.kill("SIGKILL"); });
          else child.kill("SIGKILL");
        });
      }
      service.state = { ...service.state, state: "stopped", pid: undefined, nextRestartAt: undefined };
    }));
    this.changed();
  }
}
