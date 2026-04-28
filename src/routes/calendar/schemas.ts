export const calendarSchema = {
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
        result: { type: 'string' },
      },
      required: ['result'],
    },
  },
};
