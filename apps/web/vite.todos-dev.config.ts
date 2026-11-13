// Local only (not committed): this worktree's dev ports, Vite on 5188 and wrangler on 8808.
import base from "./vite.config";

const proxy = Object.fromEntries(
  Object.entries(base.server!.proxy!).map(([path, target]) => [
    path,
    typeof target === "string" ? target.replace(":8787", ":8808") : { ...target, target: String(target.target).replace(":8787", ":8808") },
  ]),
);

export default { ...base, server: { ...base.server, port: 5188, strictPort: true, proxy } };
