import { DeltaMagnitude, IRExpr, IRValue, PplEvent, Resolution, RuntimeStateInput, SemanticBand, SourceTestRun, StaticPersonaIR } from "./types.js";
export declare function flatten(obj: unknown, prefix?: string, out?: Record<string, IRValue>): Record<string, IRValue>;
export declare function unflatten(flat: Record<string, IRValue>, prefix: string): Record<string, any>;
export declare function evaluateExpression(expr: IRExpr, env: Record<string, IRValue>): IRValue;
export declare function semanticBand(v: number): SemanticBand;
export declare function deltaMagnitude(delta: number): DeltaMagnitude;
export declare function buildSnapshot(ir: StaticPersonaIR, runtime?: RuntimeStateInput, context?: Record<string, unknown>, event?: PplEvent): Record<string, IRValue>;
export declare function resolve(ir: StaticPersonaIR, runtime?: RuntimeStateInput, context?: Record<string, unknown>, event?: PplEvent): Resolution;
export declare function applyPendingCommits(runtime: RuntimeStateInput, resolution: Resolution): RuntimeStateInput;
export declare function applyResolution(runtime: RuntimeStateInput, resolution: Resolution): RuntimeStateInput;
export declare function runSourceTests(ir: StaticPersonaIR): SourceTestRun;
export declare function mergeScene(ir: StaticPersonaIR, sceneName: string, runtime?: RuntimeStateInput, context?: Record<string, unknown>): {
    runtime: {
        state: Record<string, any>;
        schema?: string;
        session?: {
            id?: string;
            turn?: number;
        };
        relationships?: Record<string, unknown>;
    };
    context: Record<string, any>;
};
