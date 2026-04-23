import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(message: string) {
    super(message);
  }
}

export default fp(async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof Error && 'statusCode' in error) {
      const statusCode = error.statusCode;

      if (statusCode === 400) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: error.message,
        });
      }

      if (statusCode === 401) {
        return reply.code(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: error.message,
        });
      }
    }

    if (error instanceof NotFoundError) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: error.message,
      });
    }

    return reply.code(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
  });
});
