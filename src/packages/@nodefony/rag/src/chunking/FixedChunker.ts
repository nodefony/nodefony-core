// @nodefony/rag — src/chunking/FixedChunker.ts
// Chunking par taille fixe (en mots — approximation tokens)

import type { IChunker, IIndexOptions } from "../interfaces/IRagService.js";

export class FixedChunker implements IChunker {
  chunk(text: string, options: IIndexOptions = {}): string[] {
    const chunkSize    = options.chunkSize    ?? 512;
    const chunkOverlap = options.chunkOverlap ?? 50;

    if (chunkSize <= 0) throw new Error("chunkSize must be > 0");
    if (chunkOverlap < 0 || chunkOverlap >= chunkSize) {
      throw new Error("chunkOverlap must be in [0, chunkSize)");
    }

    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return [];

    const chunks: string[] = [];
    const step = chunkSize - chunkOverlap;

    for (let i = 0; i < words.length; i += step) {
      const chunk = words.slice(i, i + chunkSize).join(" ");
      if (chunk.trim().length > 0) chunks.push(chunk);
      if (i + chunkSize >= words.length) break;
    }

    return chunks;
  }
}
