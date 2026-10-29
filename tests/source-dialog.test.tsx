import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SourceDialog from "../src/components/SourceDialog";
import type { SheetLink } from "../src/lib/types";

function render(connection: SheetLink | null = null) {
  return renderToStaticMarkup(
    createElement(SourceDialog, {
      connection,
      onClose: () => {},
      onUpload: async () => {},
      onConnect: async () => {},
    }),
  );
}

describe("Data source selection", () => {
  it("prefills the user's Data-tab URL for manual connection", () => {
    const html = render();
    expect(html).toContain(
      'value="https://docs.google.com/spreadsheets/d/19zAXIdGYHdn6D8PgXD3aTn7QIa9yrQRjjlGX24x-45g/edit?gid=573832876#gid=573832876"',
    );
    expect(html).toContain("Connect spreadsheet");
  });

  it("offers Google Sheets and CSV without a demo source", () => {
    const html = render();
    expect(html).toContain("Google Sheets");
    expect(html).toContain("Upload CSV");
    expect(html).not.toContain("Sample data");
    expect(html.match(/role="tab"/g)).toHaveLength(2);
  });

  it("keeps an existing connection instead of replacing it with the preset", () => {
    const html = render({
      reference:
        "https://docs.google.com/spreadsheets/d/another-spreadsheet/edit",
      gid: "27",
    });
    expect(html).toContain(
      'value="https://docs.google.com/spreadsheets/d/another-spreadsheet/edit"',
    );
    expect(html).toContain('value="27"');
    expect(html).not.toContain("19zAXIdGYHdn6D8PgXD3aTn7QIa9yrQRjjlGX24x-45g");
  });
});
