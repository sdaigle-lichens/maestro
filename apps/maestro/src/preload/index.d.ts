import type { MaestroApi } from "../shared/ipc.js";

declare global {
  interface Window {
    maestro: MaestroApi;
  }
}

export {};
