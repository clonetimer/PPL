import { CompileOptions, CompileResult, ModuleSource, StaticPersonaIR } from "./types.js";
export declare function filesystemModuleResolver(moduleRoot: string): (id: string, _fromFile: string) => ModuleSource | undefined;
export declare function compileFile(file: string, options?: CompileOptions): CompileResult;
export declare function loadPersonaIR(file: string): StaticPersonaIR;
