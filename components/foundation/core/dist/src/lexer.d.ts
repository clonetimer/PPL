import { Diagnostic, Token } from "./types.js";
export interface LexResult {
    tokens: Token[];
    diagnostics: Diagnostic[];
}
export declare function lex(source: string, file?: string): LexResult;
