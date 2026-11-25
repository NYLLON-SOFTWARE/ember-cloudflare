// The Add Site page's one way to the app: handing it the address typed. Electron's sandbox runs preloads
// as CommonJS.
import electron = require("electron");
import type { AddSiteBridge } from "../add-site-bridge.ts";

// As ADD_SITE in add-site-bridge.ts, which a sandboxed preload can't import.
const ADD_SITE = "add-site";

const bridge: AddSiteBridge = { addSite: (typed) => electron.ipcRenderer.invoke(ADD_SITE, typed) };

electron.contextBridge.exposeInMainWorld("emberDesktop", bridge);
