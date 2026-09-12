import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGermanPhone } from "./german-phone.js";
test("normalizes German national and international registration input", () => {
  for (const value of ["015123456789", "15123456789", "+4915123456789", "004915123456789", "0151 234-56789", " +49 (151) 23456789 "]) assert.equal(normalizeGermanPhone(value), "+4915123456789");
});
test("rejects foreign countries, duplicated prefixes, malformed and invalid numbers", () => {
  for (const value of ["", "123", "+4415123456789", "004415123456789", "+49+4915123456789", "+49015123456789", "abc015123456789", "0015123456789", "00015123456789"]) assert.throws(() => normalizeGermanPhone(value));
});
