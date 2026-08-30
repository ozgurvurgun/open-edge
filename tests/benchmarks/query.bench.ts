import { bench, describe } from "vitest";
import { parseQuery } from "../../src/domain/query/parser.js";
import { tokenize } from "../../src/domain/query/lexer.js";

describe("query microbenchmarks", () => {
  bench("tokenize+parse selector", () => {
    tokenize('{service="api", environment="production"} |= "error" | json');
    parseQuery('{service="api", environment="production"} |= "error" | json');
  });
});
