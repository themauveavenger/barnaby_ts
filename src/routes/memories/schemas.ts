import { MEMORY_CATEGORY_NAMES } from '../../plugins/memory-categories.js';

export const createMemorySchema = {
  body: {
    type: 'object',
    properties: {
      // Note: maxLength 2000 chars is a proxy for ~100 words.
      // Adjust if longer memories are needed.
      content: { type: 'string', minLength: 1, maxLength: 2000 },
      category: {
        type: 'string',
        enum: [...MEMORY_CATEGORY_NAMES]
      },
      permanent: { type: 'boolean', default: false },
      tags: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        default: []
      }
    },
    required: ['content', 'category']
  }
};

export const listMemoriesSchema = {
  querystring: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: [...MEMORY_CATEGORY_NAMES]
      },
      tags: { type: 'string' },
      entity: { type: 'string' },
      q: { type: 'string' },
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
    }
  }
};

export const updateMemorySchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }
    },
    required: ['id']
  },
  body: {
    type: 'object',
    properties: {
      content: { type: 'string', minLength: 1, maxLength: 2000 },
      tags: {
        type: 'array',
        items: { type: 'string', minLength: 1 }
      }
    }
  }
};

export const deleteMemorySchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }
    },
    required: ['id']
  }
};

export const createActionSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }
    },
    required: ['id']
  },
  body: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['completed', 'dismissed']
      }
    },
    required: ['action']
  }
};

export const deleteActionSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      actionId: { type: 'string', format: 'uuid' }
    },
    required: ['id', 'actionId']
  }
};
