import {
  AssignmentNode, BinaryExpr, CommitNode, DescribeNode, Diagnostic, EffectNode, ExampleNode, Expr,
  GivenEntryNode, ImportNode, InvariantNode, IRValue, LiteralExpr, ModuleMemberNode, ModuleNode, NamedBlockNode,
  NoteNode, ParseResult, PathExpr, PersonaMemberNode, PersonaNode, ProgramNode, RuleNode, SceneNode,
  SemanticDeclNode, SemanticKind, SimpleBlockNode, SourceRange, TestNode, Token, TopLevelNode,
  TransitionNode, UnaryExpr
} from "./types.js";

class Parser {
  private pos = 0;
  diagnostics: Diagnostic[] = [];
  constructor(private tokens: Token[]) {}

  private cur() { return this.tokens[this.pos]; }
  private prev() { return this.tokens[Math.max(0, this.pos - 1)]; }
  private at(value: string) { return this.cur().value === value; }
  private consume(value?: string): Token {
    const t = this.cur();
    if (value && t.value !== value) {
      this.error(`Expected '${value}', found '${t.value}'.`, t.range);
      throw new Error("parse");
    }
    this.pos++;
    return t;
  }
  private expectIdentifier(): Token {
    const t = this.cur();
    if (t.kind !== "identifier") {
      this.error(`Expected identifier, found '${t.value}'.`, t.range);
      throw new Error("parse");
    }
    this.pos++;
    return t;
  }
  private expectString(): Token {
    const t = this.cur();
    if (t.kind !== "string") {
      this.error(`Expected string literal, found '${t.value}'.`, t.range);
      throw new Error("parse");
    }
    this.pos++;
    return t;
  }
  private error(message: string, range?: SourceRange) { this.diagnostics.push({ code: "PPL-E110", severity: "error", message, range }); }
  private range(start: Token): SourceRange { return { start: start.range.start, end: this.prev().range.end }; }

  parse(): ProgramNode | undefined {
    const declarations: TopLevelNode[] = [];
    const start = this.cur();
    try {
      while (this.cur().kind !== "eof") {
        if (this.at("persona")) declarations.push(this.parsePersona());
        else if (this.at("module")) declarations.push(this.parseModule());
        else if (this.at("scene")) declarations.push(this.parseScene());
        else {
          this.error(`Expected top-level persona, module, or scene; found '${this.cur().value}'.`, this.cur().range);
          throw new Error("parse");
        }
      }
      if (!declarations.length) {
        this.error("Source contains no top-level declarations.", start.range);
        return undefined;
      }
      return { kind: "Program", declarations, range: { start: start.range.start, end: this.prev().range.end } };
    } catch {
      if (!this.diagnostics.length) this.error("Unable to parse source.", this.cur().range);
      return undefined;
    }
  }

  private parsePersona(): PersonaNode {
    const start = this.consume("persona");
    const name = this.expectIdentifier().value;
    let version: string | undefined;
    if (this.at("version")) { this.consume(); version = this.expectString().value; }
    this.consume("{");
    const members: PersonaMemberNode[] = [];
    while (!this.at("}") && this.cur().kind !== "eof") members.push(this.parsePersonaMember());
    this.consume("}");
    return { kind: "Persona", name, version, members, range: this.range(start) };
  }

  private parseModule(): ModuleNode {
    const start = this.consume("module");
    const name = this.parsePathParts().join(".");
    let version: string | undefined;
    if (this.at("version")) { this.consume(); version = this.expectString().value; }
    this.consume("{");
    const members: ModuleMemberNode[] = [];
    while (!this.at("}") && this.cur().kind !== "eof") members.push(this.parseModuleMember());
    this.consume("}");
    return { kind: "Module", name, version, members, range: this.range(start) };
  }

  private parseScene(): SceneNode {
    const start = this.consume("scene");
    const name = this.expectIdentifier().value;
    this.consume("{");
    if (!this.at("context")) { this.error(`Scene '${name}' must begin with a context block.`, this.cur().range); throw new Error("parse"); }
    const context = this.parseSimpleBlock();
    let state: SimpleBlockNode | undefined;
    if (this.at("state")) state = this.parseSimpleBlock();
    this.consume("}");
    return { kind: "Scene", name, context, state, range: this.range(start) };
  }

  private parsePersonaMember(): PersonaMemberNode {
    const key = this.cur().value;
    if (key === "import") return this.parseImport();
    if (["meta", "identity", "traits", "values", "preferences", "context", "state", "style"].includes(key)) return this.parseSimpleBlock();
    if (key === "relationship" || key === "behavior") return this.parseNamedBlock();
    if (key === "rule") return this.parseRule();
    if (key === "describe") return this.parseDescribe();
    if (key === "invariant") return this.parseInvariant();
    if (key === "transition") return this.parseTransition();
    if (key === "note") return this.parseNote();
    if (key === "example") return this.parseExample();
    if (key === "test") return this.parseTest();
    this.error(`Unsupported persona member '${key}'.`, this.cur().range);
    throw new Error("parse");
  }

  private parseModuleMember(): ModuleMemberNode {
    const key = this.cur().value;
    if (key === "import") return this.parseImport();
    if (["traits", "values", "preferences", "state", "style"].includes(key)) return this.parseSimpleBlock();
    if (key === "behavior") return this.parseNamedBlock();
    if (key === "rule") return this.parseRule();
    if (key === "invariant") return this.parseInvariant();
    if (key === "note") return this.parseNote();
    if (key === "semantic") return this.parseSemantic();
    this.error(`Unsupported module member '${key}'.`, this.cur().range);
    throw new Error("parse");
  }

  private parseImport(): ImportNode {
    const start = this.consume("import");
    const module = this.parsePathParts().join(".");
    let version: string | undefined;
    let alias: string | undefined;
    if (this.at("version")) { this.consume(); version = this.expectString().value; }
    if (this.at("as")) { this.consume(); alias = this.expectIdentifier().value; }
    this.consume(";");
    return { kind: "Import", module, version, alias, range: this.range(start) };
  }

  private parseSimpleBlock(): SimpleBlockNode {
    const start = this.consume();
    const blockKind = start.value as SimpleBlockNode["blockKind"];
    this.consume("{");
    const assignments: AssignmentNode[] = [];
    while (!this.at("}")) assignments.push(this.parseAssignment());
    this.consume("}");
    return { kind: "SimpleBlock", blockKind, assignments, range: this.range(start) };
  }

  private parseNamedBlock(): NamedBlockNode {
    const start = this.consume();
    const blockKind = start.value as NamedBlockNode["blockKind"];
    const name = this.expectIdentifier().value;
    this.consume("{");
    const assignments: AssignmentNode[] = [];
    while (!this.at("}")) assignments.push(this.parseAssignment());
    this.consume("}");
    return { kind: "NamedBlock", blockKind, name, assignments, range: this.range(start) };
  }

  private parseAssignment(): AssignmentNode {
    const start = this.cur();
    const path = this.parsePathParts();
    let typeRef: string | undefined;
    if (this.at(":")) { this.consume(); typeRef = this.parsePathParts().join("."); }
    this.consume("=");
    const value = this.parseLiteral();
    this.consume(";");
    return { kind: "Assignment", path, typeRef, value, range: { start: start.range.start, end: this.prev().range.end } };
  }

  private parseRule(): RuleNode {
    const start = this.consume("rule");
    const name = this.expectIdentifier().value;
    let priority = 500;
    if (this.at("priority")) { this.consume(); priority = Number(this.consume().value); }
    this.consume("{");
    this.consume("when"); this.consume("{"); const condition = this.parseExpr(); this.consume(";"); this.consume("}");
    const effects: EffectNode[] = [];
    const commits: CommitNode[] = [];
    while (!this.at("}")) {
      if (this.at("effect")) {
        this.consume(); this.consume("{");
        while (!this.at("}")) effects.push(this.parseEffect());
        this.consume("}");
      } else if (this.at("commit")) {
        this.consume(); this.consume("{");
        while (!this.at("}")) commits.push(this.parseCommit());
        this.consume("}");
      } else {
        this.error(`Expected effect or commit block in rule '${name}'.`, this.cur().range);
        throw new Error("parse");
      }
    }
    this.consume("}");
    return { kind: "Rule", name, priority, condition, effects, commits, range: this.range(start) };
  }

  private parseEffect(): EffectNode {
    const start = this.cur();
    if (this.at("enable") || this.at("disable")) {
      const op = this.consume().value as "enable" | "disable";
      const path = this.parsePathParts();
      this.consume(";");
      return { kind: "Effect", op, path, range: { start: start.range.start, end: this.prev().range.end } };
    }
    const path = this.parsePathParts();
    const opToken = this.consume();
    const map: Record<string, EffectNode["op"]> = { "=": "set", "+=": "add", "-=": "sub" };
    const op = map[opToken.value];
    if (!op) { this.error(`Invalid effect operator '${opToken.value}'.`, opToken.range); throw new Error("parse"); }
    const value = this.parseExpr();
    this.consume(";");
    return { kind: "Effect", op, path, value, range: { start: start.range.start, end: this.prev().range.end } };
  }

  private parseCommit(): CommitNode {
    const start = this.cur();
    const path = this.parsePathParts();
    const opToken = this.consume();
    const map: Record<string, CommitNode["op"]> = { "=": "set", "+=": "add", "-=": "sub" };
    const op = map[opToken.value];
    if (!op) { this.error(`Invalid commit operator '${opToken.value}'.`, opToken.range); throw new Error("parse"); }
    const value = this.parseExpr();
    this.consume(";");
    return { kind: "Commit", op, path, value, range: { start: start.range.start, end: this.prev().range.end } };
  }

  private parseDescribe(): DescribeNode {
    const start = this.consume("describe");
    const path = this.parsePathParts();
    let locale = "zh_CN";
    if (this.at("locale")) { this.consume(); locale = this.expectIdentifier().value; }
    this.consume("{");
    const entries: Record<string, string | number> = {};
    while (!this.at("}")) {
      const key = this.expectIdentifier().value;
      this.consume("=");
      const val = this.consume();
      if (val.kind === "string") entries[key] = val.value;
      else if (val.kind === "number") entries[key] = Number(val.value);
      else { this.error("Descriptor values must be string or number.", val.range); throw new Error("parse"); }
      this.consume(";");
    }
    this.consume("}");
    return { kind: "Describe", path, locale, entries, range: this.range(start) };
  }

  private parseInvariant(): InvariantNode {
    const start = this.consume("invariant");
    const name = this.expectIdentifier().value;
    let priority = 1000;
    if (this.at("priority")) { this.consume(); priority = Number(this.consume().value); }
    this.consume("{");
    const assertions: Expr[] = [];
    const guides: string[] = [];
    while (!this.at("}")) {
      if (this.at("assert")) { this.consume(); assertions.push(this.parseExpr()); this.consume(";"); }
      else if (this.at("guide")) { this.consume(); guides.push(this.expectString().value); this.consume(";"); }
      else { this.error(`Expected assert or guide in invariant '${name}'.`, this.cur().range); throw new Error("parse"); }
    }
    this.consume("}");
    return { kind: "Invariant", name, priority, assertions, guides, range: this.range(start) };
  }

  private parseTransition(): TransitionNode {
    const start = this.consume("transition");
    const name = this.expectIdentifier().value;
    this.consume("{");
    this.consume("target"); const target = this.parsePathParts(); this.consume(";");
    this.consume("from"); const fromLit = this.parseLiteral(); this.consume(";");
    if (!Array.isArray(fromLit.value)) { this.error(`Transition '${name}' from must be a list.`, fromLit.range); throw new Error("parse"); }
    this.consume("to"); const to = this.parseLiteral().value; this.consume(";");
    this.consume("when"); this.consume("{"); const condition = this.parseExpr(); this.consume(";"); this.consume("}");
    this.consume("}");
    return { kind: "Transition", name, target, from: fromLit.value, to, condition, range: this.range(start) };
  }

  private parseNote(): NoteNode {
    const start = this.consume("note");
    const name = this.expectIdentifier().value;
    this.consume("{");
    const text = this.expectString().value;
    this.consume("}");
    return { kind: "Note", name, text, range: this.range(start) };
  }

  private parseExample(): ExampleNode {
    const start = this.consume("example");
    const name = this.expectIdentifier().value;
    this.consume("{");
    const given = this.parseGivenBlock();
    this.consume("output"); this.consume("{"); const output = this.expectString().value; this.consume("}");
    this.consume("}");
    return { kind: "Example", name, given, output, range: this.range(start) };
  }

  private parseTest(): TestNode {
    const start = this.consume("test");
    const name = this.expectIdentifier().value;
    this.consume("{");
    const given = this.parseGivenBlock();
    this.consume("expect"); this.consume("{");
    const expects: Expr[] = [];
    while (!this.at("}")) { expects.push(this.parseExpr()); this.consume(";"); }
    this.consume("}");
    this.consume("}");
    return { kind: "Test", name, given, expects, range: this.range(start) };
  }

  private parseGivenBlock(): GivenEntryNode[] {
    this.consume("given"); this.consume("{");
    const entries: GivenEntryNode[] = [];
    while (!this.at("}")) {
      const start = this.cur();
      const path = this.parsePathParts();
      this.consume("=");
      const value = this.parseLiteral();
      this.consume(";");
      entries.push({ kind: "GivenEntry", path, value, range: { start: start.range.start, end: this.prev().range.end } });
    }
    this.consume("}");
    return entries;
  }

  private parseSemantic(): SemanticDeclNode {
    const start = this.consume("semantic");
    const kindToken = this.expectIdentifier();
    const allowed: SemanticKind[] = ["trait", "value", "preference", "relationship", "context", "state", "style", "behavior"];
    if (!allowed.includes(kindToken.value as SemanticKind)) {
      this.error(`Unknown semantic kind '${kindToken.value}'.`, kindToken.range);
      throw new Error("parse");
    }
    const name = this.expectIdentifier().value;
    this.consume("{");
    const assignments: AssignmentNode[] = [];
    while (!this.at("}")) assignments.push(this.parseAssignment());
    this.consume("}");
    return { kind: "SemanticDecl", semanticKind: kindToken.value as SemanticKind, name, assignments, range: this.range(start) };
  }

  private parseExpr(): Expr { return this.parseOr(); }
  private parseOr(): Expr {
    let expr = this.parseAnd();
    while (this.at("or")) { this.consume(); const right = this.parseAnd(); expr = { kind: "BinaryExpr", operator: "or", left: expr, right, range: { start: expr.range.start, end: right.range.end } } as BinaryExpr; }
    return expr;
  }
  private parseAnd(): Expr {
    let expr = this.parseUnary();
    while (this.at("and")) { this.consume(); const right = this.parseUnary(); expr = { kind: "BinaryExpr", operator: "and", left: expr, right, range: { start: expr.range.start, end: right.range.end } } as BinaryExpr; }
    return expr;
  }
  private parseUnary(): Expr {
    if (this.at("not")) { const s = this.consume(); const operand = this.parseUnary(); return { kind: "UnaryExpr", operator: "not", operand, range: { start: s.range.start, end: operand.range.end } } as UnaryExpr; }
    return this.parseComparison();
  }
  private parseComparison(): Expr {
    let left = this.parsePrimary();
    if (["==", "!=", ">", "<", ">=", "<="].includes(this.cur().value)) {
      const op = this.consume().value as BinaryExpr["operator"];
      const right = this.parsePrimary();
      left = { kind: "BinaryExpr", operator: op, left, right, range: { start: left.range.start, end: right.range.end } } as BinaryExpr;
    }
    return left;
  }
  private parsePrimary(): Expr {
    if (this.at("(")) { this.consume(); const e = this.parseExpr(); this.consume(")"); return e; }
    const t = this.cur();
    if (t.kind === "number" || t.kind === "string" || t.value === "true" || t.value === "false" || t.value === "[") return this.parseLiteral();
    if (t.kind === "identifier") {
      const start = t;
      const first = this.consume().value;
      if (this.at(".")) {
        const parts = [first];
        while (this.at(".")) { this.consume(); parts.push(this.expectIdentifier().value); }
        return { kind: "PathExpr", parts, range: { start: start.range.start, end: this.prev().range.end } } as PathExpr;
      }
      return { kind: "LiteralExpr", value: first, literalKind: "Symbol", range: start.range } as LiteralExpr;
    }
    this.error(`Unexpected expression token '${t.value}'.`, t.range);
    throw new Error("parse");
  }

  private parseLiteral(): LiteralExpr {
    const start = this.cur();
    if (this.at("[")) {
      this.consume();
      const arr: IRValue[] = [];
      while (!this.at("]")) {
        arr.push(this.parseLiteral().value);
        if (this.at(",")) this.consume(); else break;
      }
      this.consume("]");
      return { kind: "LiteralExpr", value: arr, literalKind: "List", range: { start: start.range.start, end: this.prev().range.end } };
    }
    const t = this.consume();
    if (t.kind === "string") return { kind: "LiteralExpr", value: t.value, literalKind: "String", range: t.range };
    if (t.kind === "number") {
      const n = Number(t.value);
      return { kind: "LiteralExpr", value: n, literalKind: Number.isInteger(n) ? "Int" : "Float", range: t.range };
    }
    if (t.value === "true" || t.value === "false") return { kind: "LiteralExpr", value: t.value === "true", literalKind: "Bool", range: t.range };
    if (t.kind === "identifier") return { kind: "LiteralExpr", value: t.value, literalKind: "Symbol", range: t.range };
    this.error(`Expected literal, found '${t.value}'.`, t.range);
    throw new Error("parse");
  }

  private parsePathParts(): string[] {
    const parts = [this.expectIdentifier().value];
    while (this.at(".")) { this.consume(); parts.push(this.expectIdentifier().value); }
    return parts;
  }
}

export function parse(tokens: Token[]): ParseResult {
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return { ast, diagnostics: parser.diagnostics };
}
