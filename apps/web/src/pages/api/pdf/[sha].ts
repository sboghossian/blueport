import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const sha = params.sha;
  if (!sha || !/^[a-f0-9]{64}$/i.test(sha)) {
    return new Response("Not found", { status: 404 });
  }

  const env = locals.runtime.env;
  const object = await env.DOCS.get(`docs/${sha}.pdf`);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "content-type": "application/pdf",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};
