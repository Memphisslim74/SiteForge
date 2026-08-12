const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const DEVICE_PREFIXES = {
  ap: 'AP',
  camera: 'CAM',
  switch: 'SW',
  rack: 'RACK',
  drop: 'DATA',
  fiber: 'FIBER',
  access: 'ACCESS',
  note: 'NOTE',
};

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

function numberInRange(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function pageNumber(value, fallback = 1) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number >= 1 && number <= 10000 ? number : null;
}

function nullableText(value, maxLength = 2000) {
  if (value === undefined) return undefined;
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

async function getProject(env, id) {
  return env.DB.prepare(
    `SELECT id, name, client_name, site_address, description, status, created_at, updated_at
     FROM projects WHERE id = ?`
  ).bind(id).first();
}

async function getPlan(env, id) {
  return env.DB.prepare(
    `SELECT id, project_id, name, floor_name, original_filename, r2_key, page_number, created_at, updated_at
     FROM plans WHERE id = ?`
  ).bind(id).first();
}

async function getDevice(env, id) {
  return env.DB.prepare(
    `SELECT id, project_id, plan_id, device_type, label, model, pdf_page, x_percent, y_percent, rotation,
            mounting_height, cable_type, home_run, notes, status, created_at, updated_at
     FROM devices WHERE id = ?`
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
          version: '0.3.0',
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
          `SELECT pl.id, pl.project_id, pl.name, pl.floor_name, pl.original_filename, pl.page_number,
                  pl.created_at, pl.updated_at, COUNT(d.id) AS device_count
           FROM plans pl
           LEFT JOIN devices d ON d.plan_id = pl.id
           WHERE pl.project_id = ?
           GROUP BY pl.id
           ORDER BY pl.created_at DESC`
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
            device_count: 0,
            url: `/api/plans/${planId}/file`,
          },
        }, { status: 201 });
      }

      const planDevicesMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/devices$/);
      if (planDevicesMatch && method === 'POST') {
        const planId = decodeURIComponent(planDevicesMatch[1]);
        const plan = await getPlan(env, planId);
        if (!plan) return json({ error: 'Plan not found.' }, { status: 404 });

        const body = await request.json();
        const deviceType = String(body?.deviceType || '').trim().toLowerCase();
        if (!DEVICE_PREFIXES[deviceType]) {
          return json({ error: 'Unsupported device type.' }, { status: 400 });
        }

        const xPercent = numberInRange(body?.xPercent, 0, 100);
        const yPercent = numberInRange(body?.yPercent, 0, 100);
        const pdfPage = pageNumber(body?.pageNumber, 1);
        if (xPercent === null || yPercent === null || pdfPage === null) {
          return json({ error: 'Invalid device position or PDF page.' }, { status: 400 });
        }

        const countRow = await env.DB.prepare(
          `SELECT COUNT(*) AS count FROM devices WHERE plan_id = ? AND device_type = ?`
        ).bind(planId, deviceType).first();
        const sequence = Number(countRow?.count || 0) + 1;
        const defaultLabel = `${DEVICE_PREFIXES[deviceType]}-${String(sequence).padStart(2, '0')}`;
        const label = String(body?.label || defaultLabel).trim().slice(0, 80) || defaultLabel;
        const deviceId = crypto.randomUUID();

        await env.DB.prepare(
          `INSERT INTO devices (
             id, project_id, plan_id, device_type, label, model, pdf_page, x_percent, y_percent, rotation,
             mounting_height, cable_type, home_run, notes
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          deviceId,
          plan.project_id,
          planId,
          deviceType,
          label,
          nullableText(body?.model, 120) ?? null,
          pdfPage,
          xPercent,
          yPercent,
          numberInRange(body?.rotation ?? 0, -360, 360) ?? 0,
          nullableText(body?.mountingHeight, 80) ?? null,
          nullableText(body?.cableType, 80) ?? null,
          nullableText(body?.homeRun, 120) ?? null,
          nullableText(body?.notes, 4000) ?? null
        ).run();

        await env.DB.prepare(
          `UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(plan.project_id).run();

        return json({ device: await getDevice(env, deviceId) }, { status: 201 });
      }

      const planDetailMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
      if (planDetailMatch && method === 'GET') {
        const planId = decodeURIComponent(planDetailMatch[1]);
        const plan = await getPlan(env, planId);
        if (!plan) return json({ error: 'Plan not found.' }, { status: 404 });

        const { results: devices } = await env.DB.prepare(
          `SELECT id, project_id, plan_id, device_type, label, model, pdf_page, x_percent, y_percent, rotation,
                  mounting_height, cable_type, home_run, notes, status, created_at, updated_at
           FROM devices WHERE plan_id = ? ORDER BY created_at ASC`
        ).bind(planId).all();

        const { r2_key, ...safePlan } = plan;
        return json({
          plan: { ...safePlan, url: `/api/plans/${planId}/file` },
          devices: devices || [],
        });
      }

      const deviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
      if (deviceMatch && method === 'PATCH') {
        const deviceId = decodeURIComponent(deviceMatch[1]);
        const current = await getDevice(env, deviceId);
        if (!current) return json({ error: 'Device not found.' }, { status: 404 });

        const body = await request.json();
        const xPercent = body?.xPercent === undefined ? current.x_percent : numberInRange(body.xPercent, 0, 100);
        const yPercent = body?.yPercent === undefined ? current.y_percent : numberInRange(body.yPercent, 0, 100);
        const rotation = body?.rotation === undefined ? current.rotation : numberInRange(body.rotation, -360, 360);
        const pdfPage = body?.pageNumber === undefined ? current.pdf_page : pageNumber(body.pageNumber, current.pdf_page);

        if (xPercent === null || yPercent === null || rotation === null || pdfPage === null) {
          return json({ error: 'Invalid position, page, or rotation.' }, { status: 400 });
        }

        const label = body?.label === undefined
          ? current.label
          : (String(body.label || '').trim().slice(0, 80) || current.label);

        const model = body?.model === undefined ? current.model : nullableText(body.model, 120);
        const mountingHeight = body?.mountingHeight === undefined ? current.mounting_height : nullableText(body.mountingHeight, 80);
        const cableType = body?.cableType === undefined ? current.cable_type : nullableText(body.cableType, 80);
        const homeRun = body?.homeRun === undefined ? current.home_run : nullableText(body.homeRun, 120);
        const notes = body?.notes === undefined ? current.notes : nullableText(body.notes, 4000);
        const status = body?.status === undefined
          ? current.status
          : (String(body.status || 'planned').trim().slice(0, 40) || 'planned');

        await env.DB.prepare(
          `UPDATE devices
           SET label = ?, model = ?, pdf_page = ?, x_percent = ?, y_percent = ?, rotation = ?, mounting_height = ?,
               cable_type = ?, home_run = ?, notes = ?, status = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(
          label, model, pdfPage, xPercent, yPercent, rotation, mountingHeight,
          cableType, homeRun, notes, status, deviceId
        ).run();

        await env.DB.prepare(
          `UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(current.project_id).run();

        return json({ device: await getDevice(env, deviceId) });
      }

      if (deviceMatch && method === 'DELETE') {
        const deviceId = decodeURIComponent(deviceMatch[1]);
        const current = await getDevice(env, deviceId);
        if (!current) return json({ error: 'Device not found.' }, { status: 404 });

        await env.DB.prepare(`DELETE FROM devices WHERE id = ?`).bind(deviceId).run();
        await env.DB.prepare(
          `UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(current.project_id).run();
        return new Response(null, { status: 204 });
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
