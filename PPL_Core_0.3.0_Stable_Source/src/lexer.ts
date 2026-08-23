import { Diagnostic, SourceLocation, SourceRange, Token } from "./types.js";

export interface LexResult { tokens: Token[]; diagnostics: Diagnostic[]; }

const isIdStart = (c: string) => /[\p{L}_]/u.test(c);
const isIdContinue = (c: string) => /[\p{L}\p{N}_]/u.test(c);

export function lex(source: string, file = "<memory>"): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let i = 0, line = 1, column = 1;

  const loc = (): SourceLocation => ({ file, offset: i, line, column });
  const advance = () => {
    const c = source[i++];
    if (c === "\n") { line++; column = 1; } else { column++; }
    return c;
  };
  const rangeFrom = (start: SourceLocation): SourceRange => ({ start, end: loc() });
  const emit = (kind: Token["kind"], value: string, start: SourceLocation) => tokens.push({ kind, value, range: rangeFrom(start) });

  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { advance(); continue; }

    if (c === "/" && source[i + 1] === "/") {
      advance(); advance();
      while (i < source.length && source[i] !== "\n") advance();
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const start = loc(); advance(); advance();
      let closed = false;
      while (i < source.length) {
        if (source[i] === "*" && source[i + 1] === "/") { advance(); advance(); closed = true; break; }
        advance();
      }
      if (!closed) diagnostics.push({ code: "PPL-E101", severity: "error", message: "Unterminated block comment.", range: rangeFrom(start) });
      continue;
    }

    const start = loc();

    if (source.startsWith('"""', i)) {
      advance(); advance(); advance();
      let value = "";
      let closed = false;
      while (i < source.length) {
        if (source.startsWith('"""', i)) { advance(); advance(); advance(); closed = true; break; }
        value += advance();
      }
      if (!closed) diagnostics.push({ code: "PPL-E102", severity: "error", message: "Unterminated triple-quoted string.", range: rangeFrom(start) });
      emit("string", value, start);
      continue;
    }

    if (c === '"') {
      advance();
      let value = "";
      let closed = false;
      while (i < source.length) {
        if (source[i] === '"') { advance(); closed = true; break; }
        if (source[i] === "\\") {
          advance();
          const e = advance();
          value += e === "n" ? "\n" : e === "t" ? "\t" : e;
        } else value += advance();
      }
      if (!closed) diagnostics.push({ code: "PPL-E103", severity: "error", message: "Unterminated string literal.", range: rangeFrom(start) });
      emit("string", value, start);
      continue;
    }

    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      let value = "";
      while (i < source.length && /[0-9.]/.test(source[i])) value += advance();
      emit("number", value, start);
      continue;
    }

    if (isIdStart(c)) {
      let value = advance();
      while (i < source.length && isIdContinue(source[i])) value += advance();
      emit("identifier", value, start);
      continue;
    }

    const two = source.slice(i, i + 2);
    if (["+=", "-=", "==", "!=", ">=", "<="].includes(two)) {
      advance(); advance(); emit("operator", two, start); continue;
    }
    if (["=", ">", "<"].includes(c)) { advance(); emit("operator", c, start); continue; }
    if (["{", "}", "[", "]", "(", ")", ";", ":", ".", ","].includes(c)) { advance(); emit("punct", c, start); continue; }

    advance();
    diagnostics.push({ code: "PPL-E104", severity: "error", message: `Unexpected character '${c}'.`, range: rangeFrom(start) });
  }

  const end = loc();
  tokens.push({ kind: "eof", value: "<eof>", range: { start: end, end } });
  return { tokens, diagnostics };
}
