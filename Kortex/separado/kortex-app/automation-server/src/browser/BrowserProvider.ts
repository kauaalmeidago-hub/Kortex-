import type { BrowserContext, Page } from "playwright";
import type { OperationRecord } from "../types.js";

export interface BrowserProviderOptions {
  downloadsPath: string;
}

export interface ManagedBrowserContext {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export interface BrowserProvider {
  createContext(operation: OperationRecord, signal: AbortSignal, options: BrowserProviderOptions): Promise<ManagedBrowserContext>;
}
