export type PrimitiveType = "Bool" | "Int" | "Float" | "Float01" | "String" | "Symbol";
export type SemanticKind = "trait" | "value" | "preference" | "relationship" | "context" | "state" | "style" | "behavior";
export type Mutability = "immutable" | "computed" | "runtime" | "host";
export type IRValue = string | number | boolean | IRValue[];

export interface SourceLocation { file: string; offset: number; line: number; column: number; }
export interface SourceRange { start: SourceLocation; end: SourceLocation; }
export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  range?: SourceRange;
  suggestion?: string;
  notes?: string[];
}
export interface Token {
  kind: "identifier" | "number" | "string" | "operator" | "punct" | "eof";
  value: string;
  range: SourceRange;
}
export interface AstNode { kind: string; range: SourceRange; }

export interface LiteralExpr extends AstNode { kind: "LiteralExpr"; value: IRValue; literalKind: PrimitiveType | "List"; }
export interface PathExpr extends AstNode { kind: "PathExpr"; parts: string[]; }
export interface BinaryExpr extends AstNode {
  kind: "BinaryExpr";
  operator: "==" | "!=" | ">" | "<" | ">=" | "<=" | "and" | "or";
  left: Expr;
  right: Expr;
}
export interface UnaryExpr extends AstNode { kind: "UnaryExpr"; operator: "not"; operand: Expr; }
export type Expr = LiteralExpr | PathExpr | BinaryExpr | UnaryExpr;

export interface AssignmentNode extends AstNode {
  kind: "Assignment";
  path: string[];
  typeRef?: string;
  value: LiteralExpr;
}
export interface ImportNode extends AstNode {
  kind: "Import";
  module: string;
  version?: string;
  alias?: string;
}
export interface SimpleBlockNode extends AstNode {
  kind: "SimpleBlock";
  blockKind: "meta" | "identity" | "traits" | "values" | "preferences" | "context" | "state" | "style";
  assignments: AssignmentNode[];
}
export interface NamedBlockNode extends AstNode {
  kind: "NamedBlock";
  blockKind: "relationship" | "behavior";
  name: string;
  assignments: AssignmentNode[];
}
export type EffectOp = "set" | "add" | "sub" | "enable" | "disable";
export interface EffectNode extends AstNode { kind: "Effect"; op: EffectOp; path: string[]; value?: Expr; }
export interface CommitNode extends AstNode { kind: "Commit"; op: "set" | "add" | "sub"; path: string[]; value: Expr; }
export interface RuleNode extends AstNode {
  kind: "Rule";
  name: string;
  priority: number;
  condition: Expr;
  effects: EffectNode[];
  commits: CommitNode[];
}
export interface DescribeNode extends AstNode {
  kind: "Describe";
  path: string[];
  locale: string;
  entries: Record<string, string | number>;
}
export interface InvariantNode extends AstNode {
  kind: "Invariant";
  name: string;
  priority: number;
  assertions: Expr[];
  guides: string[];
}
export interface TransitionNode extends AstNode {
  kind: "Transition";
  name: string;
  target: string[];
  from: IRValue[];
  to: IRValue;
  condition: Expr;
}
export interface NoteNode extends AstNode { kind: "Note"; name: string; text: string; }
export interface GivenEntryNode extends AstNode { kind: "GivenEntry"; path: string[]; value: LiteralExpr; }
export interface ExampleNode extends AstNode { kind: "Example"; name: string; given: GivenEntryNode[]; output: string; }
export interface TestNode extends AstNode { kind: "Test"; name: string; given: GivenEntryNode[]; expects: Expr[]; }
export interface SemanticDeclNode extends AstNode {
  kind: "SemanticDecl";
  semanticKind: SemanticKind;
  name: string;
  assignments: AssignmentNode[];
}

export type PersonaMemberNode = ImportNode | SimpleBlockNode | NamedBlockNode | RuleNode | DescribeNode | InvariantNode | TransitionNode | NoteNode | ExampleNode | TestNode;
export type ModuleMemberNode = ImportNode | SimpleBlockNode | NamedBlockNode | RuleNode | InvariantNode | NoteNode | SemanticDeclNode;

export interface PersonaNode extends AstNode { kind: "Persona"; name: string; version?: string; members: PersonaMemberNode[]; }
export interface ModuleNode extends AstNode { kind: "Module"; name: string; version?: string; members: ModuleMemberNode[]; }
export interface SceneNode extends AstNode {
  kind: "Scene";
  name: string;
  context: SimpleBlockNode;
  state?: SimpleBlockNode;
}
export type TopLevelNode = PersonaNode | ModuleNode | SceneNode;
export interface ProgramNode extends AstNode { kind: "Program"; declarations: TopLevelNode[]; }

export interface SemanticLocale { label: string; definition?: string; descriptors?: Partial<Record<SemanticBand, string>>; }
export interface SemanticTypeIR {
  id: string;
  kind: SemanticKind;
  primitive: PrimitiveType;
  scale?: "standard5";
  renderPriority: number;
  locales: Record<string, SemanticLocale>;
  origin?: { module: string; version?: string };
}
export type SemanticBand = "very_low" | "low" | "medium" | "high" | "very_high";
export type DeltaMagnitude = "stable" | "slight" | "clear" | "strong";
export interface SemanticBindingIR {
  path: string;
  primitive: PrimitiveType;
  semanticType?: string;
  renderPriority: number;
  localDescriptors?: Record<string, {
    label?: string;
    priority?: number;
    descriptors: Partial<Record<SemanticBand, string>>;
  }>;
}
export interface SymbolIR { path: string; primitive: PrimitiveType; mutability: Mutability; semanticType?: string; provenance?: string; }

export interface IRExprLiteral { kind: "literal"; value: IRValue; }
export interface IRExprPath { kind: "path"; path: string; }
export interface IRExprBinary { kind: "binary"; operator: BinaryExpr["operator"]; left: IRExpr; right: IRExpr; }
export interface IRExprUnary { kind: "unary"; operator: "not"; operand: IRExpr; }
export type IRExpr = IRExprLiteral | IRExprPath | IRExprBinary | IRExprUnary;
export interface IREffect { op: EffectOp; path: string; value?: IRExpr; }
export interface IRCommit { op: "set" | "add" | "sub"; path: string; value: IRExpr; }
export interface RuleIR { id: string; priority: number; condition: IRExpr; effects: IREffect[]; commits: IRCommit[]; provenance?: string; }
export interface TransitionIR { id: string; target: string; from: IRValue[]; to: IRValue; condition: IRExpr; provenance?: string; }
export interface InvariantIR { id: string; priority: number; assertions: IRExpr[]; guides: string[]; provenance?: string; }
export interface SemanticNoteIR { id: string; text: string; provenance?: string; }
export interface ExampleIR { id: string; given: Record<string, IRValue>; output: string; provenance?: string; }
export interface TestIR { id: string; given: Record<string, IRValue>; expects: IRExpr[]; provenance?: string; }
export interface SceneIR { context: Record<string, IRValue>; state: Record<string, IRValue>; }
export interface ModuleDependencyIR { id: string; version?: string; alias?: string; file?: string; }

export interface StaticPersonaIR {
  schema: "ppl.persona-ir/0.3";
  persona: { id: string; version?: string };
  meta: Record<string, IRValue>;
  identity: Record<string, IRValue>;
  base: {
    traits: Record<string, IRValue>;
    values: Record<string, IRValue>;
    preferences: Record<string, IRValue>;
    style: Record<string, IRValue>;
    behaviors: Record<string, Record<string, IRValue>>;
  };
  contextDefaults: Record<string, IRValue>;
  runtimeInitial: { relationships: Record<string, Record<string, IRValue>>; state: Record<string, IRValue>; };
  scenes: Record<string, SceneIR>;
  symbols: Record<string, SymbolIR>;
  rules: RuleIR[];
  transitions: TransitionIR[];
  invariants: InvariantIR[];
  notes: SemanticNoteIR[];
  examples: ExampleIR[];
  tests: TestIR[];
  dependencies: ModuleDependencyIR[];
  semanticBindings: Record<string, SemanticBindingIR>;
  semanticClosure: {
    registries: Record<string, string>;
    types: Record<string, SemanticTypeIR>;
  };
  diagnostics: Diagnostic[];
}

export interface RuntimeStateInput {
  schema?: string;
  session?: { id?: string; turn?: number };
  relationships?: Record<string, unknown>;
  state?: Record<string, unknown>;
}
export interface PplEvent { type?: string; actor?: string; target?: string; topic?: string; text?: string; [key: string]: unknown; }
export interface AppliedEffectStep { rule: string; priority: number; op: EffectOp; value?: IRValue; before: IRValue | undefined; after: IRValue | undefined; }
export interface ResolutionTrace {
  path: string;
  base: IRValue | undefined;
  baseBand?: SemanticBand;
  steps: AppliedEffectStep[];
  raw: IRValue | undefined;
  final: IRValue | undefined;
  finalBand?: SemanticBand;
  delta?: number;
  deltaMagnitude?: DeltaMagnitude;
}
export interface PendingPatch {
  source: string;
  op: "set" | "add" | "sub";
  path: string;
  value: IRValue;
  from: IRValue | undefined;
  projected: IRValue | undefined;
}
export interface PendingTransition {
  source: string;
  path: string;
  from: IRValue | undefined;
  to: IRValue;
}
export interface InvariantResult { id: string; passed: boolean; guides: string[]; }
export interface Resolution {
  schema: "ppl.resolution/0.3";
  activeRules: { id: string; priority: number }[];
  activeTransitions: { id: string; target: string; to: IRValue }[];
  resolvedFlat: Record<string, IRValue>;
  resolved: {
    traits: Record<string, IRValue>;
    values: Record<string, IRValue>;
    relationships: Record<string, unknown>;
    context: Record<string, IRValue>;
    state: Record<string, unknown>;
    behaviors: Record<string, Record<string, IRValue>>;
    style: Record<string, IRValue>;
  };
  trace: Record<string, ResolutionTrace>;
  pendingCommits: PendingPatch[];
  pendingTransitions: PendingTransition[];
  invariantResults: InvariantResult[];
  diagnostics: Diagnostic[];
  valid: boolean;
}
export interface RenderOutput { staticPrompt: string; dynamicPrompt: string; diagnostics: Diagnostic[]; }
export interface SourceTestResult { id: string; passed: boolean; failures: string[]; resolution?: Resolution; }
export interface SourceTestRun { passed: number; failed: number; results: SourceTestResult[]; }

export interface ParseResult { ast?: ProgramNode; diagnostics: Diagnostic[]; }
export interface ModuleSource { id: string; file: string; source: string; }
export interface CompileOptions {
  moduleRoot?: string;
  moduleResolver?: (id: string, fromFile: string) => ModuleSource | undefined;
}
export interface CompileResult { ir?: StaticPersonaIR; diagnostics: Diagnostic[]; ast?: ProgramNode; }
