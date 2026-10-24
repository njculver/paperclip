// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorRef } from "./MarkdownEditor";

describe("MarkdownEditor with real MDXEditor and Lexical", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = createRange();
      // jsdom has no text layout; CodeMirror still measures its selections.
      range.getBoundingClientRect = () => new DOMRect();
      range.getClientRects = () => document.createElement("span").getClientRects();
      return range;
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("imports rich markdown and synchronizes controlled value changes without falling back", async () => {
    const onChange = vi.fn();
    const markdown = [
      "## Release notes",
      "",
      "> Keep **formatting**.",
      "",
      "- First task",
      "- Second task",
      "",
      "| Name | State |",
      "| --- | --- |",
      "| Editor | Ready |",
      "",
      "Ask [@QA](agent://agent-123) or visit [the docs](https://example.com).",
    ].join("\n");

    await act(async () => {
      root.render(<MarkdownEditor value={markdown} onChange={onChange} />);
    });

    expect(container.querySelector("h2")?.textContent).toBe("Release notes");
    expect(container.querySelector("blockquote strong")?.textContent).toBe("formatting");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("table")?.textContent).toContain("Editor");
    expect(container.querySelector('a[href="agent://agent-123"]')?.textContent).toBe("@QA");
    expect(container.querySelector('a[href="https://example.com"]')?.textContent).toBe("the docs");
    expect(container.querySelector("textarea")).toBeNull();

    await act(async () => {
      root.render(<MarkdownEditor value="Updated **content**." onChange={onChange} />);
    });

    expect(container.querySelector("strong")?.textContent).toBe("content");
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("exports inserted markdown through the real editor", async () => {
    const onChange = vi.fn();
    const ref = createRef<MarkdownEditorRef>();

    await act(async () => {
      root.render(<MarkdownEditor ref={ref} value="Starting text." onChange={onChange} />);
    });
    onChange.mockClear();

    await act(async () => {
      ref.current?.insertMarkdown("\n\n**Inserted text.**");
    });

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("**Inserted text.**"));
    });
    expect(container.querySelector("strong")?.textContent).toBe("Inserted text.");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("renders fenced code in CodeMirror without the removed Sandpack integration", async () => {
    const markdown = "```txt\nSample output\n```";

    await act(async () => {
      root.render(
        <MarkdownEditor value={markdown} onChange={vi.fn()} />,
      );
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".cm-editor")?.textContent).toContain("Sample output");
    });
    expect(container.querySelector("textarea")).toBeNull();
  });
});
