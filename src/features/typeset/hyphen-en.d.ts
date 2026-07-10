// hyphen 包不发布 TypeScript 声明，这里按 node_modules/hyphen/en/index.js
// 的实际导出手写最小声明（仅本项目用到的同步 API）。
declare module "hyphen/en" {
  export interface HyphenationOptions {
    hyphenChar?: string;
    minWordLength?: number;
  }
  export function hyphenateSync(text: string, options?: HyphenationOptions): string;
  export function hyphenate(text: string, options?: HyphenationOptions): Promise<string>;
}
