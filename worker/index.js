const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function cleanFilename(name = 'plan.pdf') {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'plan.pdf';
}

async function getProject(env, id) {
  return env.DB.prepare(
    `SELECT id, name, client_name, site_address, description, status, created_at, updated_at
     FROM projects WHERE id = ?`
  ).bind(id).first();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    try {
      if (url.pathname === '/api/health' && method === 'GET') {
        return json({
          app: 'SiteForge',
          status: 'ok',
          version: '0.2.0',
          database: Boolean(env.DB),
          files: Boolean(env.FILES),
        });
      }

      if (url.pathname === '/api/projects' && method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT
             p.id,
             p.name,
             p.client_name,
             p.site_address,
             p.description,
             p.status,
             p.created_at,
             p.updated_at,
             COUNT(DISTINCT pl.id) AS plan_count,
             COUNT(DISTINCT d.id) AS device_count
           FROM projects p
           LEFT JOIN plans pl ON pl.project_id = p.id
           LEFT JOIN devices d ON d.project_id = p.id
           GROUP BY p.id
           ORDER BY p.updated_at DESC`
        ).all();

        return json({ projects: results || [] });
      }

      if (url.pathname === '/api/projects' && method === 'POST') {
        const body = await request.json();
        const name = String(body?.name || '').trim();

        if (!name) {
          return json({ error: 'Project name is required.' }, { status: 400 });
        }

        const id = crypto.randomUUID();
        const clientName = String(body?.clientName || '').trim() || null;
        const siteAddress = String(body?.siteAddress || '').trim() || null;
        const description = String(body?.description || '').trim() || null;

        await env.DB.prepare(
          `INSERT INTO projects (id, name, client_name, site_address, description)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(id, name, clientName, siteAddress, description).run();

        const project = await getProject(env, id);
        return json({ project }, { status: 201 });
      }

      const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch && method === 'GET') {
        const projectId = decodeURIComponent(projectMatch[1]);
        const project = await getProject(env, projectId);

        if (!project) {
          return json({ error: 'Project not found.' }, { status: 404 });
        }

        const { results: plans } = await env.DB.prepare(
          `SELECT id, project_id, name, floor_name, original_filename, page_number, created_at, updated_at
           FROM plans WHERE project_id = ? ORDER BY created_at DESC`
        ).bind(projectId).all();

        return json({ project, plans: plans || [] });
      }

      const plansMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/plans$/);
      if (plansMatch && method === 'POST') {
        const projectId = decodeURIComponent(plansMatch[1]);
        const project = await getProject(env, projectId);

        if (!project) {
          return json({ error: 'Project not found.' }, { status: 404 });
        }

        const form = await request.formData();
        const file = form.get('file');
        const planName = String(form.get('name') || '').trim();
        const floorName = String(form.get('floorName') || '').trim() || null;

        if (!(file instanceof File) || file.size === 0) {
          return json({ error: 'A PDF file is required.' }, { status: 400 });
        }

        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (!isPdf) {
          return json({ error: 'SiteForge currently accepts PDF plans only.' }, { status: 415 });
        }

        const maxBytes = 50 * 1024 * 1024;
        if (file.size > maxBytes) {
          return json({ error: 'PDF is larger than the current 50 MB upload limit.' }, { status: 413 });
        }

        const planId = crypto.randomUUID();
        const safeName = cleanFilename(file.name);
        const r2Key = `projects/${projectId}/plans/${planId}-${safeName}`;

        await env.FILES.put(r2Key, file.stream(), {
          httpMetadata: {
            contentType: 'application/pdf',
            contentDisposition: `inline; filename="${safeName}"`,
          },
          customMetadata: {
            projectId,
            planId,
            originalFilename: file.name.slice(0, 512),
          },
        });

        try {
          await env.DB.prepare(
            `INSERT INTO plans (id, project_id, name, floor_name, original_filename, r2_key)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(
            planId,
            projectId,
            planName || file.name.replace(/\.pdf$/i, ''),
            floorName,
            file.name,
            r2Key
          ).run();

          await env.DB.prepare(
            `UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).bind(projectId).run();
        } catch (error) {
          await env.FILES.delete(r2Key);
          throw error;
        }

        return json({
          plan: {
            id: planId,
            project_id: projectId,
            name: planName || file.name.replace(/\.pdf$/i, ''),
            floor_name: floorName,
            original_filename: file.name,
            url: `/api/plans/${planId}/file`,
          },
        }, { status: 201 });
      }

      const planFileMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/file$/);
      if (planFileMatch && method === 'GET') {
        const planId = decodeURIComponent(planFileMatch[1]);
        const plan = await env.DB.prepare(
          `SELECT id, original_filename, r2_key FROM plans WHERE id = ?`
        ).bind(planId).first();

        if (!plan) {
          return json({ error: 'Plan not found.' }, { status: 404 });
        }

        const object = await env.FILES.get(plan.r2_key);
        if (!object) {
          return json({ error: 'Plan file not found.' }, { status: 404 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('cache-control', 'private, no-store');
        headers.set('content-type', 'application/pdf');
        headers.set('content-disposition', `inline; filename="${cleanFilename(plan.original_filename)}"`);

        return new Response(object.body, { headers });
      }

      return json({ error: 'Not found.' }, { status: 404 });
    } catch (error) {
      console.error('SiteForge API error', error);
      return json({ error: 'SiteForge encountered an unexpected server error.' }, { status: 500 });
    }
  },
};
