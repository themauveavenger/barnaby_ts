export const chatSchema = {
  body: {
    type: 'object',
    properties: {
      message: { type: 'string', minLength: 1 },
    },
    required: ['message'],
  },
  response: {
    200: {
      type: 'object',
      properties: {
        response: { type: 'string' },
      },
      required: ['response'],
    },
  },
};
