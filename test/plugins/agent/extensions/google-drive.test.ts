import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import type { DriveClient, DriveFile, DriveDoc } from "../../../../src/plugins/drive-client.js";
import createGoogleDriveExtension from "../../../../src/plugins/agent/extensions/google-drive.js";

function createMockExtensionAPI(): ExtensionAPI & {
  _tools: Array<{ name: string; execute: Function }>;
} {
  const tools: Array<{ name: string; execute: Function }> = [];
  return {
    registerTool: vi.fn((tool) => tools.push(tool)),
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    _tools: tools,
  } as unknown as ExtensionAPI & { _tools: typeof tools };
}

function getTools(extApi: ExtensionAPI) {
  return (
    extApi as unknown as { _tools: Array<{ name: string; execute: Function }> }
  )._tools;
}

function createMockFastify(): FastifyInstance {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as FastifyInstance;
}

function createMockDriveClient(): DriveClient {
  return {
    listDocs: vi.fn(),
    readDoc: vi.fn(),
  };
}

describe("google-drive extension", () => {
  function setup() {
    const fastify = createMockFastify();
    const driveClient = createMockDriveClient();
    const extApi = createMockExtensionAPI();
    createGoogleDriveExtension(fastify, driveClient)(extApi);
    const tools = getTools(extApi);
    return { fastify, driveClient, extApi, tools };
  }

  describe("drive_list_docs", () => {
    it("registers the tool", () => {
      const { tools } = setup();
      const tool = tools.find((t) => t.name === "drive_list_docs");
      expect(tool).toBeDefined();
    });

    it("returns a formatted list of documents", async () => {
      const { tools, driveClient } = setup();
      const tool = tools.find((t) => t.name === "drive_list_docs")!;

      const files: DriveFile[] = [
        { id: "doc-1", name: "Meeting Notes", modifiedTime: "2024-01-15T10:30:00.000Z" },
        { id: "doc-2", name: "Shopping List", modifiedTime: null },
      ];
      vi.mocked(driveClient.listDocs).mockResolvedValue(files);

      const result = await tool.execute("call-1", {});
      const text = result.content[0].text;

      expect(text).toContain("Found 2 Google Docs");
      expect(text).toContain("doc-1 | Meeting Notes | modified 2024-01-15T10:30:00.000Z");
      expect(text).toContain("doc-2 | Shopping List");
      expect(driveClient.listDocs).toHaveBeenCalledWith(undefined, undefined);
    });

    it("passes query and maxResults to client", async () => {
      const { tools, driveClient } = setup();
      const tool = tools.find((t) => t.name === "drive_list_docs")!;

      vi.mocked(driveClient.listDocs).mockResolvedValue([]);

      await tool.execute("call-1", { query: "Meeting", maxResults: 5 });
      expect(driveClient.listDocs).toHaveBeenCalledWith("Meeting", 5);
    });

    it("returns no documents message when empty", async () => {
      const { tools, driveClient } = setup();
      const tool = tools.find((t) => t.name === "drive_list_docs")!;

      vi.mocked(driveClient.listDocs).mockResolvedValue([]);

      const result = await tool.execute("call-1", {});
      expect(result.content[0].text).toBe("No Google Docs found.");
    });

    it("includes query in no-results message", async () => {
      const { tools, driveClient } = setup();
      const tool = tools.find((t) => t.name === "drive_list_docs")!;

      vi.mocked(driveClient.listDocs).mockResolvedValue([]);

      const result = await tool.execute("call-1", { query: "nonexistent" });
      expect(result.content[0].text).toContain('matching "nonexistent"');
    });

    it("returns error with hint on 403/permission errors", async () => {
      const { tools, driveClient, fastify } = setup();
      const tool = tools.find((t) => t.name === "drive_list_docs")!;

      vi.mocked(driveClient.listDocs).mockRejectedValue(
        new Error("Request had insufficient authentication scopes."),
      );

      const result = await tool.execute("call-1", {});
      const text = result.content[0].text;

      expect(text).toContain("Error:");
      expect(text).toContain("insufficient authentication scopes");
      expect(text).toContain("Hint:");
      expect(text).toContain("get-google-refresh-token");
      expect(fastify.log.error).toHaveBeenCalled();
    });

    it("returns error without hint on non-permission errors", async () => {
      const { tools, driveClient, fastify } = setup();
      const tool = tools.find((t) => t.name === "drive_list_docs")!;

      vi.mocked(driveClient.listDocs).mockRejectedValue(new Error("Network timeout"));

      const result = await tool.execute("call-1", {});
      const text = result.content[0].text;

      expect(text).toContain("Error:");
      expect(text).toContain("Network timeout");
      expect(text).not.toContain("Hint:");
      expect(fastify.log.error).toHaveBeenCalled();
    });
  });

  describe("drive_read_doc", () => {
    it("registers the tool", () => {
      const { tools } = setup();
      const tool = tools.find((t) => t.name === "drive_read_doc");
      expect(tool).toBeDefined();
    });

    it("returns document content", async () => {
      const { tools, driveClient } = setup();
      const tool = tools.find((t) => t.name === "drive_read_doc")!;

      const doc: DriveDoc = {
        name: "My Document",
        content: "This is the document content.",
      };
      vi.mocked(driveClient.readDoc).mockResolvedValue(doc);

      const result = await tool.execute("call-1", { docId: "abc123" });
      const text = result.content[0].text;

      expect(text).toContain('Document: "My Document" (abc123)');
      expect(text).toContain("This is the document content.");
      expect(driveClient.readDoc).toHaveBeenCalledWith("abc123");
    });

    it("returns error with hint on permission errors", async () => {
      const { tools, driveClient } = setup();
      const tool = tools.find((t) => t.name === "drive_read_doc")!;

      vi.mocked(driveClient.readDoc).mockRejectedValue(
        new Error("403 Forbidden"),
      );

      const result = await tool.execute("call-1", { docId: "abc123" });
      const text = result.content[0].text;

      expect(text).toContain("Error:");
      expect(text).toContain("abc123");
      expect(text).toContain("Hint:");
    });

    it("returns error without hint on non-Google-Doc files", async () => {
      const { tools, driveClient } = setup();
      const tool = tools.find((t) => t.name === "drive_read_doc")!;

      vi.mocked(driveClient.readDoc).mockRejectedValue(
        new Error('File "Budget" is not a Google Doc (mimeType: application/vnd.google-apps.spreadsheet)'),
      );

      const result = await tool.execute("call-1", { docId: "sheet-1" });
      const text = result.content[0].text;

      expect(text).toContain("Error:");
      expect(text).toContain("not a Google Doc");
      expect(text).not.toContain("Hint:");
    });

    it("returns error on file not found", async () => {
      const { tools, driveClient, fastify } = setup();
      const tool = tools.find((t) => t.name === "drive_read_doc")!;

      vi.mocked(driveClient.readDoc).mockRejectedValue(
        new Error("File not found: nonexistent"),
      );

      const result = await tool.execute("call-1", { docId: "nonexistent" });
      const text = result.content[0].text;

      expect(text).toContain("Error:");
      expect(text).toContain("File not found");
      expect(fastify.log.error).toHaveBeenCalled();
    });
  });
});