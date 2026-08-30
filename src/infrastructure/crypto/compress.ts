import type { Compressor } from "../../application/ports.js";

export function streamsCompressor(): Compressor {
  return {
    async gzip(data) {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    },
    async gunzip(data) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    },
  };
}
