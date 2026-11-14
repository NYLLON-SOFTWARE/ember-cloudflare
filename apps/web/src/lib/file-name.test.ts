import { describe, expect, it } from "vitest";
import { nameParts } from "./file-name";

describe("nameParts", () => {
  it("keeps the extension apart from the stem that can be cut short", () => {
    expect(nameParts("qa-upload.txt")).toEqual({ stem: "qa-upload", extension: ".txt" });
    expect(nameParts("archive.tar.gz")).toEqual({ stem: "archive.tar", extension: ".gz" });
  });

  it("leaves a name with no extension, or only a leading dot, whole", () => {
    expect(nameParts("README")).toEqual({ stem: "README", extension: "" });
    expect(nameParts(".env")).toEqual({ stem: ".env", extension: "" });
  });
});
