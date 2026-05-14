const triggerResponseShape = {
  type: 'object' as const,
  properties: {
    success: { type: 'boolean' as const },
    message: { type: 'string' as const }
  },
  required: ['success', 'message'] as const
};

export const briefingTriggerSchema = {
  response: {
    200: {
      ...triggerResponseShape,
      description: 'Briefing generated and sent successfully.'
    },
    502: {
      ...triggerResponseShape,
      description: 'The AI agent returned an empty response.'
    },
    503: {
      ...triggerResponseShape,
      description: 'TELEGRAM_CHAT_ID is not configured.'
    },
    504: {
      ...triggerResponseShape,
      description: 'Briefing generation timed out.'
    }
  }
};

export const afternoonUpdateTriggerSchema = {
  response: {
    200: {
      ...triggerResponseShape,
      description: 'Afternoon update generated and sent successfully.'
    },
    502: {
      ...triggerResponseShape,
      description: 'The AI agent returned an empty response.'
    },
    503: {
      ...triggerResponseShape,
      description: 'TELEGRAM_CHAT_ID is not configured.'
    },
    504: {
      ...triggerResponseShape,
      description: 'Afternoon update generation timed out.'
    }
  }
};

export const listBriefingsSchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              triggeredAt: { type: 'string' },
              triggerType: { type: 'string', enum: ['scheduled', 'manual'] }
            },
            required: ['id', 'content', 'triggeredAt', 'triggerType']
          }
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' }
          },
          required: ['page', 'limit', 'total']
        }
      },
      required: ['data', 'pagination']
    }
  }
};

export const deleteBriefingSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }
    },
    required: ['id']
  }
};
