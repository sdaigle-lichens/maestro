// Re-export only. The helpers themselves live in `src/core/text.ts`.
//
// They were copied here when the session log came across and the create-* routes had not been
// ported. Now that they have, the copy is actively dangerous: `buildDesc` decides the
// `description:` a form PREVIEWS and the one the node-side scaffold WRITES, and two
// implementations of it means a preview that can quietly stop matching the file on disk. So there
// is one implementation, in the package both processes can import from.
//
// `../../../core/text.js` — that module, not the `core/index.js` barrel. The barrel re-exports fs
// and child_process; test/isolation.test.ts fails if anything but `core/contracts` and
// `core/text` is imported from outside src/main. `core/text.ts` has no imports at all.

export { buildDesc, clip, firstSentence, joinOxford, stripNamespace, titleFromName } from "../../../core/text.js";
