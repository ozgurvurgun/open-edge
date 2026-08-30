import { gunzipSync, gzipSync } from "node:zlib";
import type { Compressor } from "../../application/ports.js";

export function nodeCompressor(): Compressor {
  return {
    async gzip(data) {
      return gzipSync(data);
    },
    async gunzip(data) {
      return gunzipSync(data);
    },
  };
}
