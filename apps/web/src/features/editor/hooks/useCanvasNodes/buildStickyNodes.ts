import * as Y from "yjs";
import { getStickyNotesMap, type StickyNote } from "@athanordb/shared";
import type { StickyNoteNodeType } from "@/features/editor/nodes/StickyNoteNode";

export function buildStickyNodes(
  stickyNotes: StickyNote[],
  doc: Y.Doc,
  palette: string[],
  onPaletteChange: (next: string[]) => void,
  canWrite = true,
): StickyNoteNodeType[] {
  return stickyNotes.map((note) => ({
    id: note.id,
    position: note.position,
    width: note.size.width,
    height: note.size.height,
    type: "sticky",
    data: {
      note,
      palette,
      readOnly: !canWrite,
      onPaletteChange,
      onTextChange: (text: string) => {
        const notes = getStickyNotesMap(doc);
        const current = notes.get(note.id);
        if (current) notes.set(note.id, { ...current, text });
      },
      onColorChange: (color: string) => {
        const notes = getStickyNotesMap(doc);
        const current = notes.get(note.id);
        if (current) notes.set(note.id, { ...current, style: { ...current.style, color } });
      },
      onResize: (position, size) => {
        const notes = getStickyNotesMap(doc);
        const current = notes.get(note.id);
        if (current) notes.set(note.id, { ...current, position, size });
      },
    },
  }));
}
