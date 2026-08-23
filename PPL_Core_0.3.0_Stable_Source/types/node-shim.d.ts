declare const process: {
  argv: string[];
  exit(code?: number): never;
  stdout: { write(text: string): void };
};

declare module "node:fs" {
  const fs: {
    readFileSync(path: string, encoding: string): string;
    writeFileSync(path: string, data: string): void;
    existsSync(path: string): boolean;
  };
  export default fs;
}

declare module "node:path" {
  const path: {
    join(...parts: string[]): string;
    dirname(p: string): string;
    basename(p: string, suffix?: string): string;
  };
  export default path;
}

declare module "node:assert/strict" {
  interface Assert {
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    match(actual: string, expected: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp): void;
  }
  const assert: Assert;
  export default assert;
}
