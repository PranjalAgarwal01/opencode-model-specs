// OpenCode plugin entrypoint for directory-based loading.
//
// OpenCode's loader resolves local plugin directories by trying `<directory>/server`
// first and `<directory>/index` second (see @opencode/plugin Host.resolve) — it does
// NOT consult package.json `main`/`exports` for directory targets. This file satisfies
// that convention; the real implementation lives in the compiled dist/ output.
export { default } from "./dist/index.js"
