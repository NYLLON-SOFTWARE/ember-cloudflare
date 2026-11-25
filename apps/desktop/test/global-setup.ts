import { createRequire } from "node:module";

/**
 * Has Electron fetch its binary, which it does the first time it's asked where the binary is, once,
 * before the tests' workers start: on a fresh install, workers asking at once would each fetch it, and
 * one would start the app while another was still writing it.
 */
export default function fetchElectron(): void {
  createRequire(import.meta.url)("electron");
}
