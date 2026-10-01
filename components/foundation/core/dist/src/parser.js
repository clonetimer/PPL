class Parser {
    tokens;
    pos = 0;
    diagnostics = [];
    constructor(tokens) {
        this.tokens = tokens;
    }
    cur() { return this.tokens[this.pos]; }
    prev() { return this.tokens[Math.max(0, this.pos - 1)]; }
    at(value) { return this.cur().value === value; }
    consume(value) {
        const t = this.cur();
        if (value && t.value !== value) {
            this.error(`Expected '${value}', found '${t.value}'.`, t.range);
            throw new Error("parse");
        }
        this.pos++;
        return t;
    }
    expectIdentifier() {
        const t = this.cur();
        if (t.kind !== "identifier") {
            this.error(`Expected identifier, found '${t.value}'.`, t.range);
            throw new Error("parse");
        }
        this.pos++;
        return t;
    }
    expectString() {
        const t = this.cur();
        if (t.kind !== "string") {
            this.error(`Expected string literal, found '${t.value}'.`, t.range);
            throw new Error("parse");
        }
        this.pos++;
        return t;
    }
    error(message, range) { this.diagnostics.push({ code: "PPL-E110", severity: "error", message, range }); }
    range(start) { return { start: start.range.start, end: this.prev().range.end }; }
    parse() {
        const declarations = [];
        const start = this.cur();
        try {
            while (this.cur().kind !== "eof") {
                if (this.at("persona"))
                    declarations.push(this.parsePersona());
                else if (this.at("module"))
                    declarations.push(this.parseModule());
                else if (this.at("scene"))
                    declarations.push(this.parseScene());
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
        }
        catch {
            if (!this.diagnostics.length)
                this.error("Unable to parse source.", this.cur().range);
            return undefined;
        }
    }
    parsePersona() {
        const start = this.consume("persona");
        const name = this.expectIdentifier().value;
        let version;
        if (this.at("version")) {
            this.consume();
            version = this.expectString().value;
        }
        this.consume("{");
        const members = [];
        while (!this.at("}") && this.cur().kind !== "eof")
            members.push(this.parsePersonaMember());
        this.consume("}");
        return { kind: "Persona", name, version, members, range: this.range(start) };
    }
    parseModule() {
        const start = this.consume("module");
        const name = this.parsePathParts().join(".");
        let version;
        if (this.at("version")) {
            this.consume();
            version = this.expectString().value;
        }
        this.consume("{");
        const members = [];
        while (!this.at("}") && this.cur().kind !== "eof")
            members.push(this.parseModuleMember());
        this.consume("}");
        return { kind: "Module", name, version, members, range: this.range(start) };
    }
    parseScene() {
        const start = this.consume("scene");
        const name = this.expectIdentifier().value;
        this.consume("{");
        if (!this.at("context")) {
            this.error(`Scene '${name}' must begin with a context block.`, this.cur().range);
            throw new Error("parse");
        }
        const context = this.parseSimpleBlock();
        let state;
        if (this.at("state"))
            state = this.parseSimpleBlock();
        this.consume("}");
        return { kind: "Scene", name, context, state, range: this.range(start) };
    }
    parsePersonaMember() {
        const key = this.cur().value;
        if (key === "import")
            return this.parseImport();
        if (["meta", "identity", "traits", "values", "preferences", "context", "state", "style"].includes(key))
            return this.parseSimpleBlock();
        if (key === "relationship" || key === "behavior")
            return this.parseNamedBlock();
        if (key === "rule")
            return this.parseRule();
        if (key === "describe")
            return this.parseDescribe();
        if (key === "invariant")
            return this.parseInvariant();
        if (key === "transition")
            return this.parseTransition();
        if (key === "note")
            return this.parseNote();
        if (key === "example")
            return this.parseExample();
        if (key === "test")
            return this.parseTest();
        this.error(`Unsupported persona member '${key}'.`, this.cur().range);
        throw new Error("parse");
    }
    parseModuleMember() {
        const key = this.cur().value;
        if (key === "import")
            return this.parseImport();
        if (["traits", "values", "preferences", "state", "style"].includes(key))
            return this.parseSimpleBlock();
        if (key === "behavior")
            return this.parseNamedBlock();
        if (key === "rule")
            return this.parseRule();
        if (key === "invariant")
            return this.parseInvariant();
        if (key === "note")
            return this.parseNote();
        if (key === "semantic")
            return this.parseSemantic();
        this.error(`Unsupported module member '${key}'.`, this.cur().range);
        throw new Error("parse");
    }
    parseImport() {
        const start = this.consume("import");
        const module = this.parsePathParts().join(".");
        let version;
        let alias;
        if (this.at("version")) {
            this.consume();
            version = this.expectString().value;
        }
        if (this.at("as")) {
            this.consume();
            alias = this.expectIdentifier().value;
        }
        this.consume(";");
        return { kind: "Import", module, version, alias, range: this.range(start) };
    }
    parseSimpleBlock() {
        const start = this.consume();
        const blockKind = start.value;
        this.consume("{");
        const assignments = [];
        while (!this.at("}"))
            assignments.push(this.parseAssignment());
        this.consume("}");
        return { kind: "SimpleBlock", blockKind, assignments, range: this.range(start) };
    }
    parseNamedBlock() {
        const start = this.consume();
        const blockKind = start.value;
        const name = this.expectIdentifier().value;
        this.consume("{");
        const assignments = [];
        while (!this.at("}"))
            assignments.push(this.parseAssignment());
        this.consume("}");
        return { kind: "NamedBlock", blockKind, name, assignments, range: this.range(start) };
    }
    parseAssignment() {
        const start = this.cur();
        const path = this.parsePathParts();
        let typeRef;
        if (this.at(":")) {
            this.consume();
            typeRef = this.parsePathParts().join(".");
        }
        this.consume("=");
        const value = this.parseLiteral();
        this.consume(";");
        return { kind: "Assignment", path, typeRef, value, range: { start: start.range.start, end: this.prev().range.end } };
    }
    parseRule() {
        const start = this.consume("rule");
        const name = this.expectIdentifier().value;
        let priority = 500;
        if (this.at("priority")) {
            this.consume();
            priority = Number(this.consume().value);
        }
        this.consume("{");
        this.consume("when");
        this.consume("{");
        const condition = this.parseExpr();
        this.consume(";");
        this.consume("}");
        const effects = [];
        const commits = [];
        while (!this.at("}")) {
            if (this.at("effect")) {
                this.consume();
                this.consume("{");
                while (!this.at("}"))
                    effects.push(this.parseEffect());
                this.consume("}");
            }
            else if (this.at("commit")) {
                this.consume();
                this.consume("{");
                while (!this.at("}"))
                    commits.push(this.parseCommit());
                this.consume("}");
            }
            else {
                this.error(`Expected effect or commit block in rule '${name}'.`, this.cur().range);
                throw new Error("parse");
            }
        }
        this.consume("}");
        return { kind: "Rule", name, priority, condition, effects, commits, range: this.range(start) };
    }
    parseEffect() {
        const start = this.cur();
        if (this.at("enable") || this.at("disable")) {
            const op = this.consume().value;
            const path = this.parsePathParts();
            this.consume(";");
            return { kind: "Effect", op, path, range: { start: start.range.start, end: this.prev().range.end } };
        }
        const path = this.parsePathParts();
        const opToken = this.consume();
        const map = { "=": "set", "+=": "add", "-=": "sub" };
        const op = map[opToken.value];
        if (!op) {
            this.error(`Invalid effect operator '${opToken.value}'.`, opToken.range);
            throw new Error("parse");
        }
        const value = this.parseExpr();
        this.consume(";");
        return { kind: "Effect", op, path, value, range: { start: start.range.start, end: this.prev().range.end } };
    }
    parseCommit() {
        const start = this.cur();
        const path = this.parsePathParts();
        const opToken = this.consume();
        const map = { "=": "set", "+=": "add", "-=": "sub" };
        const op = map[opToken.value];
        if (!op) {
            this.error(`Invalid commit operator '${opToken.value}'.`, opToken.range);
            throw new Error("parse");
        }
        const value = this.parseExpr();
        this.consume(";");
        return { kind: "Commit", op, path, value, range: { start: start.range.start, end: this.prev().range.end } };
    }
    parseDescribe() {
        const start = this.consume("describe");
        const path = this.parsePathParts();
        let locale = "zh_CN";
        if (this.at("locale")) {
            this.consume();
            locale = this.expectIdentifier().value;
        }
        this.consume("{");
        const entries = {};
        while (!this.at("}")) {
            const key = this.expectIdentifier().value;
            this.consume("=");
            const val = this.consume();
            if (val.kind === "string")
                entries[key] = val.value;
            else if (val.kind === "number")
                entries[key] = Number(val.value);
            else {
                this.error("Descriptor values must be string or number.", val.range);
                throw new Error("parse");
            }
            this.consume(";");
        }
        this.consume("}");
        return { kind: "Describe", path, locale, entries, range: this.range(start) };
    }
    parseInvariant() {
        const start = this.consume("invariant");
        const name = this.expectIdentifier().value;
        let priority = 1000;
        if (this.at("priority")) {
            this.consume();
            priority = Number(this.consume().value);
        }
        this.consume("{");
        const assertions = [];
        const guides = [];
        while (!this.at("}")) {
            if (this.at("assert")) {
                this.consume();
                assertions.push(this.parseExpr());
                this.consume(";");
            }
            else if (this.at("guide")) {
                this.consume();
                guides.push(this.expectString().value);
                this.consume(";");
            }
            else {
                this.error(`Expected assert or guide in invariant '${name}'.`, this.cur().range);
                throw new Error("parse");
            }
        }
        this.consume("}");
        return { kind: "Invariant", name, priority, assertions, guides, range: this.range(start) };
    }
    parseTransition() {
        const start = this.consume("transition");
        const name = this.expectIdentifier().value;
        this.consume("{");
        this.consume("target");
        const target = this.parsePathParts();
        this.consume(";");
        this.consume("from");
        const fromLit = this.parseLiteral();
        this.consume(";");
        if (!Array.isArray(fromLit.value)) {
            this.error(`Transition '${name}' from must be a list.`, fromLit.range);
            throw new Error("parse");
        }
        this.consume("to");
        const to = this.parseLiteral().value;
        this.consume(";");
        this.consume("when");
        this.consume("{");
        const condition = this.parseExpr();
        this.consume(";");
        this.consume("}");
        this.consume("}");
        return { kind: "Transition", name, target, from: fromLit.value, to, condition, range: this.range(start) };
    }
    parseNote() {
        const start = this.consume("note");
        const name = this.expectIdentifier().value;
        this.consume("{");
        const text = this.expectString().value;
        this.consume("}");
        return { kind: "Note", name, text, range: this.range(start) };
    }
    parseExample() {
        const start = this.consume("example");
        const name = this.expectIdentifier().value;
        this.consume("{");
        const given = this.parseGivenBlock();
        this.consume("output");
        this.consume("{");
        const output = this.expectString().value;
        this.consume("}");
        this.consume("}");
        return { kind: "Example", name, given, output, range: this.range(start) };
    }
    parseTest() {
        const start = this.consume("test");
        const name = this.expectIdentifier().value;
        this.consume("{");
        const given = this.parseGivenBlock();
        this.consume("expect");
        this.consume("{");
        const expects = [];
        while (!this.at("}")) {
            expects.push(this.parseExpr());
            this.consume(";");
        }
        this.consume("}");
        this.consume("}");
        return { kind: "Test", name, given, expects, range: this.range(start) };
    }
    parseGivenBlock() {
        this.consume("given");
        this.consume("{");
        const entries = [];
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
    parseSemantic() {
        const start = this.consume("semantic");
        const kindToken = this.expectIdentifier();
        const allowed = ["trait", "value", "preference", "relationship", "context", "state", "style", "behavior"];
        if (!allowed.includes(kindToken.value)) {
            this.error(`Unknown semantic kind '${kindToken.value}'.`, kindToken.range);
            throw new Error("parse");
        }
        const name = this.expectIdentifier().value;
        this.consume("{");
        const assignments = [];
        while (!this.at("}"))
            assignments.push(this.parseAssignment());
        this.consume("}");
        return { kind: "SemanticDecl", semanticKind: kindToken.value, name, assignments, range: this.range(start) };
    }
    parseExpr() { return this.parseOr(); }
    parseOr() {
        let expr = this.parseAnd();
        while (this.at("or")) {
            this.consume();
            const right = this.parseAnd();
            expr = { kind: "BinaryExpr", operator: "or", left: expr, right, range: { start: expr.range.start, end: right.range.end } };
        }
        return expr;
    }
    parseAnd() {
        let expr = this.parseUnary();
        while (this.at("and")) {
            this.consume();
            const right = this.parseUnary();
            expr = { kind: "BinaryExpr", operator: "and", left: expr, right, range: { start: expr.range.start, end: right.range.end } };
        }
        return expr;
    }
    parseUnary() {
        if (this.at("not")) {
            const s = this.consume();
            const operand = this.parseUnary();
            return { kind: "UnaryExpr", operator: "not", operand, range: { start: s.range.start, end: operand.range.end } };
        }
        return this.parseComparison();
    }
    parseComparison() {
        let left = this.parsePrimary();
        if (["==", "!=", ">", "<", ">=", "<="].includes(this.cur().value)) {
            const op = this.consume().value;
            const right = this.parsePrimary();
            left = { kind: "BinaryExpr", operator: op, left, right, range: { start: left.range.start, end: right.range.end } };
        }
        return left;
    }
    parsePrimary() {
        if (this.at("(")) {
            this.consume();
            const e = this.parseExpr();
            this.consume(")");
            return e;
        }
        const t = this.cur();
        if (t.kind === "number" || t.kind === "string" || t.value === "true" || t.value === "false" || t.value === "[")
            return this.parseLiteral();
        if (t.kind === "identifier") {
            const start = t;
            const first = this.consume().value;
            if (this.at(".")) {
                const parts = [first];
                while (this.at(".")) {
                    this.consume();
                    parts.push(this.expectIdentifier().value);
                }
                return { kind: "PathExpr", parts, range: { start: start.range.start, end: this.prev().range.end } };
            }
            return { kind: "LiteralExpr", value: first, literalKind: "Symbol", range: start.range };
        }
        this.error(`Unexpected expression token '${t.value}'.`, t.range);
        throw new Error("parse");
    }
    parseLiteral() {
        const start = this.cur();
        if (this.at("[")) {
            this.consume();
            const arr = [];
            while (!this.at("]")) {
                arr.push(this.parseLiteral().value);
                if (this.at(","))
                    this.consume();
                else
                    break;
            }
            this.consume("]");
            return { kind: "LiteralExpr", value: arr, literalKind: "List", range: { start: start.range.start, end: this.prev().range.end } };
        }
        const t = this.consume();
        if (t.kind === "string")
            return { kind: "LiteralExpr", value: t.value, literalKind: "String", range: t.range };
        if (t.kind === "number") {
            const n = Number(t.value);
            return { kind: "LiteralExpr", value: n, literalKind: Number.isInteger(n) ? "Int" : "Float", range: t.range };
        }
        if (t.value === "true" || t.value === "false")
            return { kind: "LiteralExpr", value: t.value === "true", literalKind: "Bool", range: t.range };
        if (t.kind === "identifier")
            return { kind: "LiteralExpr", value: t.value, literalKind: "Symbol", range: t.range };
        this.error(`Expected literal, found '${t.value}'.`, t.range);
        throw new Error("parse");
    }
    parsePathParts() {
        const parts = [this.expectIdentifier().value];
        while (this.at(".")) {
            this.consume();
            parts.push(this.expectIdentifier().value);
        }
        return parts;
    }
}
export function parse(tokens) {
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return { ast, diagnostics: parser.diagnostics };
}
