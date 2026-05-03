import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";

export default function createTelegramExtension(fastify: FastifyInstance): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "telegram_send_message",
      label: "Send Telegram Message",
      description: "Send a message via Telegram",
      parameters: Type.Object({
        text: Type.String({ description: "The message text to send via Telegram" }),
      }),
      async execute(_toolCallId, params) {
        const chatIdEnv = process.env.TELEGRAM_CHAT_ID;
        if (!chatIdEnv) {
          return {
            content: [{ type: "text" as const, text: "TELEGRAM_CHAT_ID is not configured" }],
            details: {},
          };
        }

        const chatId = Number(chatIdEnv);
        try {
          await fastify.telegramClient.sendMessage(chatId, params.text);
          return {
            content: [{ type: "text" as const, text: "Message sent successfully" }],
            details: {},
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: `Failed to send message: ${message}` }],
            details: {},
          };
        }
      },
    });
  };
}
