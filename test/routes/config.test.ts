import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp } from '../helper.js';

describe('Config Page', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should reject unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/config'
    });
    expect(response.statusCode).toBe(401);
  });

  it('should render the personality selection form', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: authHeader }
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Yarnaby');
    expect(response.payload).toContain('Barnaby');
    expect(response.payload).toContain('value="yarnaby" selected');
  });

  it('should update the active personality and persist', async () => {
    const postResponse = await app.inject({
      method: 'POST',
      url: '/config',
      headers: {
        'authorization': authHeader,
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload: 'personality=barnaby'
    });

    expect(postResponse.statusCode).toBe(302);
    expect(postResponse.headers.location).toBe('/config');

    const getResponse = await app.inject({
      method: 'GET',
      url: '/config',
      headers: { authorization: authHeader }
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.payload).toContain('value="barnaby" selected');
  });

  it('should trigger agent resource loader reload on change', async () => {
    let reloadCalled = false;
    const agent = app.agent;
    const originalReload = agent.resourceLoader.reload.bind(agent.resourceLoader);
    agent.resourceLoader.reload = async () => {
      reloadCalled = true;
      await originalReload();
    };

    await app.inject({
      method: 'POST',
      url: '/config',
      headers: {
        'authorization': authHeader,
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload: 'personality=barnaby'
    });

    expect(reloadCalled).toBe(true);
  });
});
