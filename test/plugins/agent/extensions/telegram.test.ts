import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import createTelegramExtension from "../../../../src/plugins/agent/extensions/telegram.js";

function createMockExtensionAPI(): ExtensionAPI & { _tools: Array<{ name: string; execute: Function }> } {
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
  return (extApi as unknown as { _tools: Array<{ name: string; execute: Function }> })._tools;
}

function createMockFastify(sendMessage: Function = vi.fn().mockResolvedValue(undefined)) {
  return {
    telegramClient: { sendMessage },
    log: { info: vi.fn(), error: vi.fn() },
  } as unknown as FastifyInstance;
}

describe("telegram_send_message", () => {
  function setup(sendMessage?: Function) {
    const fastify = createMockFastify(sendMessage);
    const extApi = createMockExtensionAPI();
    createTelegramExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find((t) => t.name === "telegram_send_message")!;
    return { fastify, extApi, tool };
  }

  it("registers telegram_send_message tool", () => {
    const { extApi } = setup();
    expect(extApi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "telegram_send_message" })
    );
  });

  it("executes sendMessage with correct args", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const { tool } = setup(sendMessage);

    process.env.TELEGRAM_CHAT_ID = "12345";
    const result = await tool.execute("call-1", { text: "Hello" });

    expect(sendMessage).toHaveBeenCalledWith(12345, "Hello");
    expect(result.content[0].text).toBe("Message sent successfully");
  });

  it("handles missing TELEGRAM_CHAT_ID", async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    const { tool } = setup();

    const result = await tool.execute("call-1", { text: "Hello" });

    expect(result.content[0].text).toBe("TELEGRAM_CHAT_ID is not configured");
  });

  it("handles sendMessage failure", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("API error"));
    const { tool } = setup(sendMessage);

    process.env.TELEGRAM_CHAT_ID = "12345";
    const result = await tool.execute("call-1", { text: "Hello" });

    expect(result.content[0].text).toBe("Failed to send message: API error");
  });
});
