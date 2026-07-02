export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "job-finder-agent",
        checkedAt: new Date().toISOString(),
      });
    }

    return new Response("Hello from Job Finder Agent.\n", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  },
};
