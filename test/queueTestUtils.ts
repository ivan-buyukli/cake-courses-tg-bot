export function createMockQueue<Body>(captured: Body[] = []): Queue<Body> {
  const metrics = {
    backlogCount: 0,
    backlogBytes: 0,
  };

  return {
    metrics: async () => metrics,
    send: async (body: Body) => {
      captured.push(body);
      return { metadata: { metrics } };
    },
    sendBatch: async (requests: Iterable<MessageSendRequest<Body>>) => {
      for (const request of requests) captured.push(request.body);
      return { metadata: { metrics } };
    },
  };
}
