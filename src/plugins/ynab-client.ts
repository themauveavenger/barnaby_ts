import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import * as ynab from "ynab";

export type YnabClient = {
  api: ynab.API;
};

export default fp(async function ynabClientPlugin(fastify: FastifyInstance): Promise<void> {
  const accessToken = process.env.YNAB_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("YNAB_ACCESS_TOKEN environment variable is required");
  }
  const api = new ynab.API(accessToken);
  fastify.decorate("ynabClient", { api });
});
