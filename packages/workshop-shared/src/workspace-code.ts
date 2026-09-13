import * as Y from "yjs";

/** A native file edit against a caller-authorized workpiece's Yjs root map.
 * Resolve rootName from native WorkpieceSummary.filesRoot; this type grants no access.
 */
export type WorkspaceFileEdit = {
  /** Replace the whole file, or create it if absent. */
  toolName: "writeFile";
  /** The native workpiece file root, selected by the authorized caller. */
  rootName: string;
  /** File name within that root. */
  filename: string;
  /** Entire new file contents. */
  content: string;
} | {
  /** Replace one exact, unique match within an existing file. */
  toolName: "editFile";
  /** The native workpiece file root, selected by the authorized caller. */
  rootName: string;
  /** File name within that root. */
  filename: string;
  /** Exact existing text, which must match exactly once. */
  textToReplace: string;
  /** Text replacing the unique match. */
  replacement: string;
};

/** Apply the native agent's file-edit semantics to an existing Y.Doc.
 * Callers own authorization and read-before-edit policy. The helper neither commits nor
 * transmits changes: encode a V2 delta and submit through an authorized native capability.
 */
export function applyWorkspaceFileEdit(ydoc: Y.Doc, edit: WorkspaceFileEdit): void {
  switch (edit.toolName) {
    case "writeFile":
      ydoc.transact(() => {
        let txt = new Y.Text();
        txt.insert(0, edit.content);
        ydoc.getMap<Y.Text>(edit.rootName).set(edit.filename, txt);
      });
      break;

    case "editFile": {
      let text = ydoc.getMap<Y.Text>(edit.rootName).get(edit.filename);
      if (!text) {
        throw new Error("File does not exist.");
      }

      let content = text.toString();
      let pos = content.indexOf(edit.textToReplace);
      if (pos < 0) {
        throw new Error("No matching text was found in the file.");
      }
      if (content.indexOf(edit.textToReplace, pos + 1) >= 0) {
        throw new Error("Multiple matches were found. The text to match must be unique.");
      }

      ydoc.transact(() => {
        text.delete(pos, edit.textToReplace.length);
        text.insert(pos, edit.replacement);
      });
      break;
    }

    default:
      edit satisfies never;
      throw new Error("Unknown edit.");
  }
}
