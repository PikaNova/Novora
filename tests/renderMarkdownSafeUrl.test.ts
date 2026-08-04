import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown, safeUrl } from "../src/utils/renderMarkdown.js";

test("safeUrl allows only approved URL families", () => {
  assert.equal(safeUrl("https://example.com/doc"), "https://example.com/doc");
  assert.equal(safeUrl("mailto:admin@example.com"), "mailto:admin@example.com");
  assert.equal(safeUrl("#section"), "#section");
  assert.equal(safeUrl("/settings/profile"), "/settings/profile");
});

test("safeUrl rejects unsafe and ambiguous URL families", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,alert(1)", "//evil.example", "http://example.com", "./relative"]) {
    assert.equal(safeUrl(value), "#");
  }
});

test("renderMarkdown safely falls back for unsafe link and image targets", () => {
  const html = renderMarkdown("[bad](javascript:alert(1)) ![image](//evil.example/x.png)");
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("//evil.example"));
  assert.match(html, /href="#"/);
  assert.match(html, /src="#"/);
});

test("renderMarkdown escapes markup inside allowed URLs", () => {
  const html = renderMarkdown("[link](https://example.com/?q='><script>alert(1)</script>)");
  assert.ok(!html.includes("<script>"));
  assert.match(html, /href="[^"]*"/);
});
