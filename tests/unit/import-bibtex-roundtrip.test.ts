/** Pure-logic tests (no database): BibTeX parse → format → parse keeps every field. Run: npx tsx --test tests/unit/import-bibtex-roundtrip.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bibFile, fieldsOf, formatBibtex, parseBibtex, parseBibtexDetailed, referenceBibtex } from "../../src/lib/research/bibtex";
import { extractMarkdown, formatCitation, shortLabel } from "../../src/lib/research/cite";

const SRC = `% a comment line
@string{jfe = "Journal of Financial Economics"}
@article{gorton2019,
  author = {Gorton, Gary and {Bank of Canada} and de la Fontaine, Jean},
  title = {The {B}ayesian Flight to Safety: $\\alpha$ \\& more},
  journal = jfe,
  year = 2019, volume = {12}, number = {3}, pages = {45--67},
  month = jan,
  x-custom = "kept {as} is",
  keywords = {safe assets, crises},
  doi = {https://doi.org/10.1016/J.JFINECO.2019.09.005}
}
@book(knuth84, title = {The TeXbook}, author = "Donald E. Knuth", year = {1984}, publisher = {Addison-Wesley})
`;
const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

test("every field of every entry survives parse → format → parse", () => {
  const first = parseBibtex(SRC);
  assert.equal(first.length, 2);
  const g = first[0];
  assert.equal(g.fields["x-custom"], "kept {as} is"); assert.equal(g.fields.journal, "Journal of Financial Economics"); assert.equal(g.fields.month, "jan");
  assert.equal(g.fields.author, "Gorton, Gary and {Bank of Canada} and de la Fontaine, Jean"); assert.equal(g.fields.title, "The {B}ayesian Flight to Safety: $\\alpha$ \\& more");
  assert.equal(g.doi, "10.1016/j.jfineco.2019.09.005"); assert.deepEqual(g.authors, ["Gary Gorton", "Bank of Canada", "Jean de la Fontaine"]);
  const again = parseBibtex(first.map((e) => formatBibtex({ citeKey: e.citeKey, entryType: e.entryType, fields: e.fields })).join("\n\n"));
  assert.deepEqual(again.map((e) => sorted(e.fields)), first.map((e) => sorted(e.fields)));
  assert.deepEqual(again.map((e) => [e.citeKey, e.entryType]), first.map((e) => [e.citeKey, e.entryType]));
});

test("the export of stored rows round-trips, with or without a stored entry, and never leaks application data", () => {
  const rows = parseBibtex(SRC).map((p, i) => ({ citeKey: p.citeKey, entryType: p.entryType, title: p.title, authors: p.authors, year: p.year, journal: p.journal, doi: p.doi, url: p.url, bibtex: i === 0 ? null : p.bibtex, fields: { ...p.fields, extracts: [{ id: "1", quote: "q {unbalanced", page: "3", note: null, createdAt: "2026-01-01" }] } }));
  const file = bibFile(rows);
  assert.ok(!file.includes("extracts") && !file.includes("unbalanced"));
  const back = parseBibtexDetailed(file);
  assert.deepEqual(back.errors, []);
  for (const r of rows) { const b = back.entries.find((e) => e.citeKey === r.citeKey)!; const { extracts: _x, ...tags } = r.fields as Record<string, unknown>; assert.deepEqual(sorted(b.fields), sorted(tags)); }
});

test("stored fields win over the structured columns (no silent rewrite of names or protected capitals)", () => {
  const f = fieldsOf({ title: "The Bayesian Flight", authors: ["Gary Gorton", "Bank of Canada"], year: 2019, journal: "JFE", doi: "10.1/x", url: null, entryType: "article", fields: { author: "Gorton, Gary and {Bank of Canada}", title: "The {B}ayesian Flight", note: "keep me" } });
  assert.equal(f.author, "Gorton, Gary and {Bank of Canada}"); assert.equal(f.title, "The {B}ayesian Flight"); assert.equal(f.note, "keep me");
  assert.equal(f.year, "2019"); assert.equal(f.journal, "JFE"); assert.equal(f.doi, "10.1/x");
  const manual = referenceBibtex({ citeKey: "k", entryType: "book", title: "T", authors: ["Ada Lovelace"], year: 1843, journal: "Taylor", fields: {} });
  assert.match(manual, /author\s+= \{Lovelace, Ada\}/); assert.match(manual, /publisher\s+= \{Taylor\}/);
});

test("a malformed entry is reported and does not reject the others", () => {
  const r = parseBibtexDetailed(`@article{ok, title = {Fine}, year = {2020}}\n@article{bad, title = {Unbalanced\n`);
  assert.deepEqual(r.entries.map((e) => e.citeKey), ["ok"]); assert.equal(r.errors.length, 1); assert.equal(r.errors[0].citeKey, "bad");
  assert.throws(() => parseBibtex("@article{bad, title = {Unbalanced"));
});

test("citations", () => {
  const [g] = parseBibtex(SRC);
  assert.equal(shortLabel(g), "Gorton et al. (2019)");
  assert.equal(formatCitation(g), "Gorton, G., Bank of Canada, & de la Fontaine, J. (2019). The Bayesian Flight to Safety: $\\alpha$ \\& more. Journal of Financial Economics, 12(3), 45–67. https://doi.org/10.1016/j.jfineco.2019.09.005");
  assert.equal(extractMarkdown({ citeKey: "gorton2019" }, { quote: "Line one\nline two", page: "12" }), "> Line one\n> line two\n> — (gorton2019, p. 12)");
  assert.equal(extractMarkdown({ citeKey: "k" }, { quote: "Q", page: null }), "> Q\n> — (k)");
});
