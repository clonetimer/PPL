import fs from "node:fs";
import path from "node:path";
import { compile } from "./compiler.js";
export function filesystemModuleResolver(moduleRoot) {
    return (id, _fromFile) => {
        const file = path.join(moduleRoot, ...id.split(".")) + ".ppl";
        if (!fs.existsSync(file))
            return undefined;
        return { id, file, source: fs.readFileSync(file, "utf8") };
    };
}
export function compileFile(file, options = {}) {
    const source = fs.readFileSync(file, "utf8");
    const root = options.moduleRoot ?? path.join(path.dirname(file), "modules");
    const resolver = options.moduleResolver ?? filesystemModuleResolver(root);
    return compile(source, file, { ...options, moduleRoot: root, moduleResolver: resolver });
}
export function loadPersonaIR(file) {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || value.schema !== "ppl.persona-ir/0.3")
        throw new Error(`'${file}' is not a PPL Persona IR 0.3 artifact.`);
    if (!value.semanticClosure?.types || !value.symbols || !Array.isArray(value.rules))
        throw new Error(`'${file}' is missing required Persona IR fields.`);
    return value;
}
