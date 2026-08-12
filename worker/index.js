export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({
        app: 'SiteForge',
        status: 'ok',
        version: '0.1.0',
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
