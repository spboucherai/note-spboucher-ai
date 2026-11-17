/** Pure-logic tests (no database): upload validation, ZIP safety, duplicate keys. Run: npx tsx --test tests/unit/import-validate.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { ImportError, LIMITS, contentKey, detectKind, normText, readZipDirectory, sniff, unsafeZipPath, validateUpload, validateZip } from "../../src/lib/import/validate";

/** Minimal ZIP writer (stored entries) that lets a test lie about names and sizes. */
function fakeZip(entries: { name: string; data?: Buffer; declared?: number; flags?: number; external?: number }[]): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8"); const data = e.data ?? Buffer.alloc(0); const size = e.declared ?? data.length;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(e.flags ?? 0, 6); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(e.flags ?? 0, 8); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(e.external ?? 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, data); centrals.push(central, name); offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const code = (fn: () => unknown) => { try { fn(); } catch (e) { assert.ok(e instanceof ImportError, `expected ImportError, got ${e}`); return e.code; } return "no error"; };

test("sniff recognises ZIP, PDF, legacy Office, text and binary", () => {
  assert.equal(sniff(Buffer.from("PK\x03\x04rest")), "zip");
  assert.equal(sniff(Buffer.from("%PDF-1.7\n…")), "pdf");
  assert.equal(sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2])), "ole");
  assert.equal(sniff(Buffer.from("# Title\n\ntext é")), "text");
  assert.equal(sniff(Buffer.from([0x41, 0x00, 0x42])), "binary");
  assert.equal(sniff(Buffer.alloc(0)), "empty");
});

test("the extension is not trusted: content must match the claimed kind", () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj"); const text = Buffer.from("hello");
  assert.equal(code(() => validateUpload({ kind: "zip", buffer: pdf, filename: "notes.zip" })), "type_mismatch");
  assert.equal(code(() => validateUpload({ kind: "pdf", buffer: text, filename: "paper.pdf" })), "type_mismatch");
  assert.equal(code(() => validateUpload({ kind: "markdown", buffer: pdf, filename: "notes.md" })), "type_mismatch");
  assert.equal(code(() => validateUpload({ kind: "docx", buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), filename: "old.docx" })), "type_mismatch");
  assert.equal(code(() => validateUpload({ kind: "json", buffer: Buffer.from("[1,2]"), filename: "x.json" })), "bad_json");
  assert.equal(code(() => validateUpload({ kind: "markdown", buffer: Buffer.alloc(0), filename: "x.md" })), "empty_file");
  assert.equal(validateUpload({ kind: "pdf", buffer: pdf, filename: "paper.pdf" }).sniffed, "pdf");
  assert.equal(validateUpload({ kind: "markdown", buffer: text, filename: "a.md" }).kind, "markdown");
});

test("size limits per kind", () => {
  const big = Buffer.alloc(LIMITS.perKind.markdown + 1, 0x61);
  assert.equal(code(() => validateUpload({ kind: "markdown", buffer: big, filename: "big.md" })), "file_too_large");
});

test("a real ZIP made by jszip is read and accepted; a .docx needs word/document.xml", async () => {
  const z = new JSZip(); z.file("Notes/Hello.md", "# Hello\n\nworld"); z.file("Notes/img/a.png", Buffer.from([1, 2, 3]));
  const buf = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const facts = validateZip(buf);
  assert.equal(facts.files, 2); assert.deepEqual(facts.entries.filter((e) => !e.dir).map((e) => e.name).sort(), ["Notes/Hello.md", "Notes/img/a.png"]);
  assert.equal(facts.entries.find((e) => e.name === "Notes/Hello.md")!.uncompressedSize, 14);
  assert.equal(validateUpload({ kind: "zip", buffer: buf, filename: "notes.zip" }).zip!.files, 2);
  assert.equal(code(() => validateUpload({ kind: "docx", buffer: buf, filename: "notes.docx" })), "type_mismatch");
  const d = new JSZip(); d.file("[Content_Types].xml", "<Types/>"); d.file("word/document.xml", "<w:document/>");
  assert.equal(validateUpload({ kind: "docx", buffer: await d.generateAsync({ type: "nodebuffer" }), filename: "a.docx" }).kind, "docx");
});

test("zip-slip: unsafe member names are refused", () => {
  assert.equal(unsafeZipPath("a/b.md"), null);
  assert.equal(unsafeZipPath("a/..b/c..md"), null);
  for (const bad of ["../evil.md", "a/../../evil.md", "/etc/passwd", "\\\\server\\x", "C:\\x.md", "a\\..\\b", "a\0b"]) assert.notEqual(unsafeZipPath(bad), null, bad);
  assert.equal(code(() => validateZip(fakeZip([{ name: "ok.md", data: Buffer.from("x") }, { name: "../../outside.md", data: Buffer.from("x") }]))), "zip_unsafe_path");
  assert.equal(code(() => validateZip(fakeZip([{ name: "/abs.md", data: Buffer.from("x") }]))), "zip_unsafe_path");
});

test("zip bomb: entry cap, declared size caps and compression ratio", () => {
  const many = fakeZip(Array.from({ length: 30 }, (_v, i) => ({ name: `f${i}.md`, data: Buffer.from("x") })));
  assert.equal(code(() => validateZip(many, { entries: 10 })), "zip_too_many_entries");
  assert.equal(validateZip(many, { entries: 30 }).files, 30);
  const huge = fakeZip([{ name: "a.bin", data: Buffer.from("x"), declared: 400 * 1024 * 1024 }]);
  assert.equal(code(() => validateZip(huge)), "zip_entry_too_large");
  const total = fakeZip(Array.from({ length: 12 }, (_v, i) => ({ name: `f${i}.bin`, data: Buffer.from("x"), declared: 200 * 1024 * 1024 })));
  assert.equal(code(() => validateZip(total)), "zip_too_large");
  const ratio = fakeZip([{ name: "a.bin", data: Buffer.alloc(1024), declared: 200 * 1024 * 1024 }]);
  assert.equal(code(() => validateZip(ratio)), "zip_bomb");
});

test("encrypted, truncated and ZIP64 archives get a clear error; symlinks are counted, not followed", () => {
  assert.equal(code(() => validateZip(fakeZip([{ name: "a.md", data: Buffer.from("x"), flags: 1 }]))), "zip_encrypted");
  assert.equal(code(() => readZipDirectory(Buffer.from("PK\x03\x04 not really a zip, long enough to scan"))), "bad_zip");
  const z64 = fakeZip([{ name: "a.md", data: Buffer.from("x") }]); z64.writeUInt16LE(0xffff, z64.length - 22 + 10);
  assert.equal(code(() => readZipDirectory(z64)), "zip64");
  const link = validateZip(fakeZip([{ name: "a.md", data: Buffer.from("x") }, { name: "link", data: Buffer.from("/etc/passwd"), external: (0xa1ff << 16) >>> 0 }]));
  assert.equal(link.symlinks, 1); assert.equal(link.files, 1);
});

test("detectKind and duplicate keys", () => {
  assert.equal(detectKind("Paper.PDF"), "pdf"); assert.equal(detectKind("refs.bib"), "bibtex"); assert.equal(detectKind("x", "application/zip"), "zip");
  assert.equal(code(() => detectKind("virus.exe")), "unsupported_type");
  assert.equal(normText("Hello,   World!\n[image: fig 1]  ÉTÉ"), "hello world été");
  assert.equal(contentKey(" My Page ", "Some  text."), contentKey("my page", "some text"));
  assert.notEqual(contentKey("My Page", "Some text"), contentKey("My Page", "Other text"));
  assert.notEqual(contentKey("A", "x"), contentKey("B", "x"));
});
