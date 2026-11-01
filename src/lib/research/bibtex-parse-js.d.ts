declare module "bibtex-parse-js" {
  export interface BibtexEntry { citationKey?: string; entryType: string; entryTags?: Record<string, string>; entry?: string }
  export function toJSON(bibtex: string): BibtexEntry[];
  export function toBibtex(json: BibtexEntry[]): string;
}
