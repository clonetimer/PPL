import {
  AssignmentNode, Expr, ModuleMemberNode, PersonaMemberNode, ProgramNode, SimpleBlockNode, TopLevelNode
} from "./types.js";

const q = (s: string) => JSON.stringify(s);
const indent = (n: number) => "    ".repeat(n);

function lit(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(lit).join(", ")}]`;
  if (typeof v === "string") return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(v) ? v : q(v);
  return String(v);
}
function expr(e: Expr): string {
  if (e.kind === "LiteralExpr") return e.literalKind === "String" ? q(String(e.value)) : lit(e.value);
  if (e.kind === "PathExpr") return e.parts.join(".");
  if (e.kind === "UnaryExpr") return `not ${expr(e.operand)}`;
  const left = e.left.kind === "BinaryExpr" && ["and", "or"].includes(e.left.operator) && e.left.operator !== e.operator ? `(${expr(e.left)})` : expr(e.left);
  const right = e.right.kind === "BinaryExpr" && ["and", "or"].includes(e.right.operator) && e.right.operator !== e.operator ? `(${expr(e.right)})` : expr(e.right);
  return `${left} ${e.operator} ${right}`;
}
function assignment(a: AssignmentNode, level: number): string {
  const type = a.typeRef ? `: ${a.typeRef}` : "";
  const value = a.value.literalKind === "String" ? q(String(a.value.value)) : lit(a.value.value);
  return `${indent(level)}${a.path.join(".")}${type} = ${value};`;
}
function simpleBlock(b: SimpleBlockNode, level: number): string {
  return `${indent(level)}${b.blockKind} {\n${b.assignments.map(a => assignment(a, level + 1)).join("\n")}\n${indent(level)}}`;
}
function given(entries: any[], level: number): string {
  return `${indent(level)}given {\n${entries.map((g: any) => `${indent(level + 1)}${g.path.join(".")} = ${g.value.literalKind === "String" ? q(String(g.value.value)) : lit(g.value.value)};`).join("\n")}\n${indent(level)}}`;
}
function member(m: PersonaMemberNode | ModuleMemberNode, level: number): string {
  if (m.kind === "Import") return `${indent(level)}import ${m.module}${m.version ? ` version ${q(m.version)}` : ""}${m.alias ? ` as ${m.alias}` : ""};`;
  if (m.kind === "SimpleBlock") return simpleBlock(m, level);
  if (m.kind === "NamedBlock") return `${indent(level)}${m.blockKind} ${m.name} {\n${m.assignments.map(a => assignment(a, level + 1)).join("\n")}\n${indent(level)}}`;
  if (m.kind === "Rule") {
    const lines = [`${indent(level)}rule ${m.name}${m.priority !== 500 ? ` priority ${m.priority}` : ""} {`, `${indent(level + 1)}when {`, `${indent(level + 2)}${expr(m.condition)};`, `${indent(level + 1)}}`];
    if (m.effects.length) {
      lines.push("", `${indent(level + 1)}effect {`);
      for (const e of m.effects) {
        if (e.op === "enable" || e.op === "disable") lines.push(`${indent(level + 2)}${e.op} ${e.path.join(".")};`);
        else lines.push(`${indent(level + 2)}${e.path.join(".")} ${e.op === "set" ? "=" : e.op === "add" ? "+=" : "-="} ${expr(e.value!)};`);
      }
      lines.push(`${indent(level + 1)}}`);
    }
    if (m.commits.length) {
      lines.push("", `${indent(level + 1)}commit {`);
      for (const c of m.commits) lines.push(`${indent(level + 2)}${c.path.join(".")} ${c.op === "set" ? "=" : c.op === "add" ? "+=" : "-="} ${expr(c.value)};`);
      lines.push(`${indent(level + 1)}}`);
    }
    lines.push(`${indent(level)}}`);
    return lines.join("\n");
  }
  if (m.kind === "Describe") {
    const lines = [`${indent(level)}describe ${m.path.join(".")} locale ${m.locale} {`];
    const order = ["label", "priority", "very_low", "low", "medium", "high", "very_high"];
    for (const k of order) if (m.entries[k] !== undefined) lines.push(`${indent(level + 1)}${k} = ${typeof m.entries[k] === "string" ? q(String(m.entries[k])) : String(m.entries[k])};`);
    lines.push(`${indent(level)}}`); return lines.join("\n");
  }
  if (m.kind === "Invariant") {
    const lines = [`${indent(level)}invariant ${m.name}${m.priority !== 1000 ? ` priority ${m.priority}` : ""} {`];
    for (const a of m.assertions) lines.push(`${indent(level + 1)}assert ${expr(a)};`);
    for (const g of m.guides) lines.push(`${indent(level + 1)}guide ${q(g)};`);
    lines.push(`${indent(level)}}`); return lines.join("\n");
  }
  if (m.kind === "Transition") return [
    `${indent(level)}transition ${m.name} {`,
    `${indent(level + 1)}target ${m.target.join(".")};`,
    `${indent(level + 1)}from ${lit(m.from)};`,
    `${indent(level + 1)}to ${lit(m.to)};`,
    `${indent(level + 1)}when {`,
    `${indent(level + 2)}${expr(m.condition)};`,
    `${indent(level + 1)}}`,
    `${indent(level)}}`
  ].join("\n");
  if (m.kind === "Note") return `${indent(level)}note ${m.name} {\n${indent(level + 1)}${q(m.text)}\n${indent(level)}}`;
  if (m.kind === "Example") return `${indent(level)}example ${m.name} {\n${given(m.given, level + 1)}\n\n${indent(level + 1)}output {\n${indent(level + 2)}${q(m.output)}\n${indent(level + 1)}}\n${indent(level)}}`;
  if (m.kind === "Test") return `${indent(level)}test ${m.name} {\n${given(m.given, level + 1)}\n\n${indent(level + 1)}expect {\n${m.expects.map(e => `${indent(level + 2)}${expr(e)};`).join("\n")}\n${indent(level + 1)}}\n${indent(level)}}`;
  if (m.kind === "SemanticDecl") return `${indent(level)}semantic ${m.semanticKind} ${m.name} {\n${m.assignments.map(a => assignment(a, level + 1)).join("\n")}\n${indent(level)}}`;
  return "";
}
function top(d: TopLevelNode): string {
  if (d.kind === "Persona") return `persona ${d.name}${d.version ? ` version ${q(d.version)}` : ""} {\n\n${d.members.map(m => member(m, 1)).join("\n\n")}\n}`;
  if (d.kind === "Module") return `module ${d.name}${d.version ? ` version ${q(d.version)}` : ""} {\n\n${d.members.map(m => member(m, 1)).join("\n\n")}\n}`;
  const parts = [`scene ${d.name} {`, simpleBlock(d.context, 1)];
  if (d.state) parts.push("", simpleBlock(d.state, 1));
  parts.push("}"); return parts.join("\n");
}
export function formatAst(ast: ProgramNode): string { return ast.declarations.map(top).join("\n\n") + "\n"; }
