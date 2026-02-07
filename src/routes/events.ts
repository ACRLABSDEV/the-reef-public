import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getRecentEvents } from '../engine/state.js';

const events = new Hono();

// GET /events/stream — SSE stream of world events
events.get('/stream', (c) => {
  return streamSSE(c, async (stream) => {
    let lastEventId = 0;

    // Send initial state
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ message: 'Connected to The Reef event stream.' }),
    });

    // Poll for new events every 2 seconds
    while (true) {
      try {
        const recentEvents = getRecentEvents(100);
        const newEvents = recentEvents.filter((e) => e.id > lastEventId);

        for (const event of newEvents) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify({
              id: event.id,
              tick: event.tick,
              type: event.type,
              description: event.description,
              location: event.locationId,
              timestamp: event.createdAt,
            }),
            id: String(event.id),
          });
          lastEventId = event.id;
        }

        await stream.sleep(2000);
      } catch {
        // Client disconnected
        break;
      }
    }
  });
});

export default events;
