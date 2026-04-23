export const createMemorySchema = {
  body: {
    type: 'object',
    properties: {
      // Note: maxLength 2000 chars is a proxy for ~100 words.
      // Adjust if longer memories are needed.
      content: { type: 'string', minLength: 1, maxLength: 2000 },
      category: {
        type: 'string',
        enum: ['appointment', 'note', 'todo', 'purchase'],
      },
      tags: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        default: [],
      },
    },
    required: ['content', 'category'],
  },
};

export const getMemorySchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
    required: ['id'],
  },
};

export const listMemoriesSchema = {
  querystring: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['appointment', 'note', 'todo', 'purchase'],
      },
      tags: { type: 'string' },
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
  },
};

export const deleteMemorySchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
    required: ['id'],
  },
};
