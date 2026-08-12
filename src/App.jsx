import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const emptyProject = {
  name: '',
  clientName: '',
  siteAddress: '',
  description: '',
};

const deviceTools = [
  { type: 'ap', short: 'AP', label: 'Access Point' },
  { type: 'camera', short: 'CAM', label: 'Camera' },
  { type: 'rack', short: 'RACK', label: 'Rack / IDF' },
  { type: 'switch', short: 'SW', label: 'Switch' },
  { type: 'drop', short: 'DATA', label: 'Data Drop' },
  { type: 'fiber', short: 'FBR', label: 'Fiber' },
  { type: 'access', short: 'ACS', label: 'Access Control' },
  { type: 'note', short: 'NOTE', label: 'Note' },
];

function deviceTool(type) {
  return deviceTools.find((tool) => tool.type === type) || { short: '?', label: type };
}

function deviceDraftFrom(device) {
  return {
    label: device?.label || '',
    model: device?.model || '',
    mountingHeight: device?.mounting_height || '',
    cableType: device?.cable_type || '',
    homeRun: device?.home_run || '',
    notes: device?.notes || '',
    rotation: Number(device?.rotation || 0),
  };
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [plans, setPlans] = useState([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [planFile, setPlanFile] = useState(null);
  const [planName, setPlanName] = useState('');
  const [floorName, setFloorName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  const [workspacePlan, setWorkspacePlan] = useState(null);
  const [devices, setDevices] = useState([]);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [activeTool, setActiveTool] = useState(null);
  const [movingDevice, setMovingDevice] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceDraft, setDeviceDraft] = useState(deviceDraftFrom(null));
  const [savingDevice, setSavingDevice] = useState(false);
  const [hostWidth, setHostWidth] = useState(900);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });

  const canvasRef = useRef(null);
  const blueprintHostRef = useRef(null);
  const surfaceRef = useRef(null);

  const selectedSummary = useMemo(() => {
    if (!selectedProject) return null;
    return projects.find((project) => project.id === selectedProject.id) || selectedProject;
  }, [projects, selectedProject]);

  const visibleDevices = useMemo(
    () => devices.filter((device) => Number(device.pdf_page || 1) === page),
    [devices, page]
  );

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (!workspacePlan || !blueprintHostRef.current) return undefined;
    const node = blueprintHostRef.current;
    const update = () => setHostWidth(Math.max(node.clientWidth, 320));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [workspacePlan]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !hostWidth) return undefined;

    let renderTask;
    let cancelled = false;

    async function renderPdfPage() {
      try {
        const pdfPage = await pdfDoc.getPage(page);
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const fitWidth = Math.max(hostWidth - 36, 280);
        const fitScale = fitWidth / baseViewport.width;
        const viewport = pdfPage.getViewport({ scale: fitScale * zoom });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const context = canvas.getContext('2d', { alpha: false });
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        setSurfaceSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) });

        renderTask = pdfPage.render({
          canvasContext: context,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
        });
        await renderTask.promise;
      } catch (error) {
        if (error?.name !== 'RenderingCancelledException') {
          setPdfError('SiteForge could not render this PDF page.');
        }
      }
    }

    renderPdfPage();
    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [pdfDoc, page, zoom, hostWidth]);

  async function api(path, options) {
    const response = await fetch(path, options);
    if (response.status === 204) return {};
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  async function loadProjects() {
    try {
      setLoading(true);
      const data = await api('/api/projects');
      setProjects(data.projects || []);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function openProject(project) {
    try {
      setMessage('');
      const data = await api(`/api/projects/${encodeURIComponent(project.id)}`);
      setSelectedProject(data.project);
      setPlans(data.plans || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function createProject(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setMessage('');
      const data = await api('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(projectForm),
      });
      setProjectForm(emptyProject);
      setShowNewProject(false);
      await loadProjects();
      await openProject(data.project);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadPlan(event) {
    event.preventDefault();
    if (!selectedProject || !planFile) return;

    try {
      setUploading(true);
      setMessage('');
      const form = new FormData();
      form.append('file', planFile);
      form.append('name', planName);
      form.append('floorName', floorName);

      const data = await api(`/api/projects/${encodeURIComponent(selectedProject.id)}/plans`, {
        method: 'POST',
        body: form,
      });

      setPlanFile(null);
      setPlanName('');
      setFloorName('');
      const input = document.getElementById('plan-file');
      if (input) input.value = '';
      await openProject(selectedProject);
      await loadProjects();
      setMessage('Blueprint uploaded successfully. Opening workspace…');
      await openWorkspace(data.plan);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
    }
  }

  async function openWorkspace(plan) {
    try {
      setMessage('');
      setPdfError('');
      setPdfLoading(true);
      setWorkspacePlan(plan);
      setDevices([]);
      setPage(1);
      setZoom(1);
      setActiveTool(null);
      setMovingDevice(null);
      setSelectedDevice(null);

      const detail = await api(`/api/plans/${encodeURIComponent(plan.id)}`);
      setWorkspacePlan(detail.plan);
      setDevices(detail.devices || []);

      const fileResponse = await fetch(detail.plan.url);
      if (!fileResponse.ok) throw new Error('Unable to load the blueprint PDF.');
      const bytes = await fileResponse.arrayBuffer();
      const task = pdfjsLib.getDocument({ data: bytes });
      const document = await task.promise;
      setPdfDoc(document);
    } catch (error) {
      setPdfError(error.message);
    } finally {
      setPdfLoading(false);
    }
  }

  async function closeWorkspace() {
    if (pdfDoc) {
      try { await pdfDoc.destroy(); } catch { /* nothing */ }
    }
    setPdfDoc(null);
    setWorkspacePlan(null);
    setDevices([]);
    setSelectedDevice(null);
    setActiveTool(null);
    setMovingDevice(null);
    if (selectedProject) await openProject(selectedProject);
    await loadProjects();
  }

  async function handlePlanClick(event) {
    if ((!activeTool && !movingDevice) || placing || !surfaceRef.current) return;
    if (event.target.closest('.device-marker')) return;

    const rect = surfaceRef.current.getBoundingClientRect();
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
    if (xPercent < 0 || xPercent > 100 || yPercent < 0 || yPercent > 100) return;

    try {
      setPlacing(true);
      setMessage('');

      if (movingDevice) {
        const data = await api(`/api/devices/${encodeURIComponent(movingDevice.id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ xPercent, yPercent, pageNumber: page }),
        });
        setDevices((current) => current.map((item) => item.id === data.device.id ? data.device : item));
        setMovingDevice(null);
        setMessage(`${data.device.label} moved.`);
        return;
      }

      const data = await api(`/api/plans/${encodeURIComponent(workspacePlan.id)}/devices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deviceType: activeTool,
          xPercent,
          yPercent,
          pageNumber: page,
        }),
      });
      setDevices((current) => [...current, data.device]);
      selectDevice(data.device);
      setMessage(`${data.device.label} placed. Tap another location to place another ${deviceTool(activeTool).label}.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setPlacing(false);
    }
  }

  function selectDevice(device) {
    setSelectedDevice(device);
    setDeviceDraft(deviceDraftFrom(device));
  }

  async function saveSelectedDevice(event) {
    event.preventDefault();
    if (!selectedDevice) return;
    try {
      setSavingDevice(true);
      const data = await api(`/api/devices/${encodeURIComponent(selectedDevice.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(deviceDraft),
      });
      setDevices((current) => current.map((item) => item.id === data.device.id ? data.device : item));
      selectDevice(data.device);
      setMessage(`${data.device.label} saved.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingDevice(false);
    }
  }

  function startMoveSelected() {
    if (!selectedDevice) return;
    setMovingDevice(selectedDevice);
    setActiveTool(null);
    setSelectedDevice(null);
    setMessage(`Tap the new location for ${selectedDevice.label}.`);
  }

  async function deleteSelectedDevice() {
    if (!selectedDevice) return;
    const label = selectedDevice.label;
    if (!window.confirm(`Remove ${label} from this plan?`)) return;
    try {
      setSavingDevice(true);
      await api(`/api/devices/${encodeURIComponent(selectedDevice.id)}`, { method: 'DELETE' });
      setDevices((current) => current.filter((item) => item.id !== selectedDevice.id));
      setSelectedDevice(null);
      setMessage(`${label} removed.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingDevice(false);
    }
  }

  if (workspacePlan) {
    const toolInstruction = movingDevice
      ? `MOVE MODE · Tap the new location for ${movingDevice.label}`
      : activeTool
        ? `PLACE ${deviceTool(activeTool).label.toUpperCase()} · Tap anywhere on the blueprint`
        : 'Select a device type, then tap the blueprint to place it.';

    return (
      <main className="field-shell">
        <header className="field-header">
          <div className="field-title">
            <button className="secondary back-button" type="button" onClick={closeWorkspace}>← Projects</button>
            <div>
              <p className="eyebrow">BLUEPRINT WORKSPACE</p>
              <h1>{workspacePlan.name}</h1>
              <span>{workspacePlan.floor_name || workspacePlan.original_filename}</span>
            </div>
          </div>
          <div className="field-controls">
            {pdfDoc?.numPages > 1 && (
              <div className="segmented">
                <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
                <span>Page {page} / {pdfDoc.numPages}</span>
                <button type="button" disabled={page >= pdfDoc.numPages} onClick={() => setPage((value) => Math.min(pdfDoc.numPages, value + 1))}>›</button>
              </div>
            )}
            <div className="segmented">
              <button type="button" onClick={() => setZoom((value) => Math.max(.65, +(value - .15).toFixed(2)))}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((value) => Math.min(2.5, +(value + .15).toFixed(2)))}>+</button>
            </div>
          </div>
        </header>

        <nav className="device-toolbar" aria-label="Device placement tools">
          {deviceTools.map((tool) => (
            <button
              key={tool.type}
              type="button"
              className={`tool-button ${activeTool === tool.type ? 'active' : ''}`}
              onClick={() => {
                setMovingDevice(null);
                setSelectedDevice(null);
                setActiveTool((current) => current === tool.type ? null : tool.type);
              }}
            >
              <span className={`tool-icon type-${tool.type}`}>{tool.short}</span>
              <span>{tool.label}</span>
            </button>
          ))}
          <button
            type="button"
            className="tool-button cancel-tool"
            onClick={() => { setActiveTool(null); setMovingDevice(null); }}
            disabled={!activeTool && !movingDevice}
          >
            <span className="tool-icon">×</span>
            <span>Cancel</span>
          </button>
        </nav>

        <div className={`field-instruction ${activeTool || movingDevice ? 'armed' : ''}`}>
          <strong>{toolInstruction}</strong>
          <span>{visibleDevices.length} device{visibleDevices.length === 1 ? '' : 's'} on this page</span>
        </div>

        {message && <div className="notice field-notice">{message}</div>}

        <div className={`blueprint-layout ${selectedDevice ? 'with-inspector' : ''}`}>
          <section className="blueprint-host" ref={blueprintHostRef}>
            {pdfLoading && <div className="blueprint-loading">Loading blueprint…</div>}
            {pdfError && <div className="blueprint-error"><strong>PDF error</strong><span>{pdfError}</span></div>}
            {!pdfError && (
              <div
                className={`blueprint-surface ${activeTool || movingDevice ? 'placing-mode' : ''}`}
                ref={surfaceRef}
                style={{ width: surfaceSize.width || undefined, height: surfaceSize.height || undefined }}
                onClick={handlePlanClick}
              >
                <canvas ref={canvasRef} className="pdf-canvas" />
                <div className="marker-layer">
                  {visibleDevices.map((device) => {
                    const tool = deviceTool(device.device_type);
                    return (
                      <button
                        type="button"
                        key={device.id}
                        className={`device-marker type-${device.device_type} ${selectedDevice?.id === device.id ? 'selected' : ''}`}
                        style={{
                          left: `${device.x_percent}%`,
                          top: `${device.y_percent}%`,
                          transform: `translate(-50%, -50%) rotate(${Number(device.rotation || 0)}deg)`,
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setActiveTool(null);
                          setMovingDevice(null);
                          selectDevice(device);
                        }}
                        aria-label={`${tool.label} ${device.label}`}
                      >
                        <span>{tool.short}</span>
                        <small>{device.label}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {selectedDevice && (
            <aside className="device-inspector">
              <div className="inspector-head">
                <div>
                  <p className="eyebrow">{deviceTool(selectedDevice.device_type).label.toUpperCase()}</p>
                  <h2>{selectedDevice.label}</h2>
                </div>
                <button className="icon-button" type="button" onClick={() => setSelectedDevice(null)}>×</button>
              </div>

              <form onSubmit={saveSelectedDevice}>
                <label>
                  Label
                  <input value={deviceDraft.label} onChange={(e) => setDeviceDraft({ ...deviceDraft, label: e.target.value })} />
                </label>
                <label>
                  UniFi model
                  <input value={deviceDraft.model} onChange={(e) => setDeviceDraft({ ...deviceDraft, model: e.target.value })} placeholder={selectedDevice.device_type === 'ap' ? 'U7 Pro' : selectedDevice.device_type === 'camera' ? 'G6 Bullet' : 'Model / part'} />
                </label>
                <div className="form-row inspector-row">
                  <label>
                    Mount height
                    <input value={deviceDraft.mountingHeight} onChange={(e) => setDeviceDraft({ ...deviceDraft, mountingHeight: e.target.value })} placeholder="22 ft" />
                  </label>
                  <label>
                    Cable
                    <input value={deviceDraft.cableType} onChange={(e) => setDeviceDraft({ ...deviceDraft, cableType: e.target.value })} placeholder="CAT6A" />
                  </label>
                </div>
                <label>
                  Home run / IDF
                  <input value={deviceDraft.homeRun} onChange={(e) => setDeviceDraft({ ...deviceDraft, homeRun: e.target.value })} placeholder="IDF-01" />
                </label>
                {selectedDevice.device_type === 'camera' && (
                  <label>
                    Camera direction
                    <input type="range" min="-180" max="180" step="5" value={deviceDraft.rotation} onChange={(e) => setDeviceDraft({ ...deviceDraft, rotation: Number(e.target.value) })} />
                    <span className="range-value">{deviceDraft.rotation}°</span>
                  </label>
                )}
                <label>
                  Notes
                  <textarea rows="4" value={deviceDraft.notes} onChange={(e) => setDeviceDraft({ ...deviceDraft, notes: e.target.value })} placeholder="Mount below steel beam, verify lift access…" />
                </label>

                <div className="inspector-actions">
                  <button className="secondary" type="button" onClick={startMoveSelected}>Move</button>
                  <button className="primary" type="submit" disabled={savingDevice}>{savingDevice ? 'Saving…' : 'Save'}</button>
                </div>
                <button className="danger-button" type="button" disabled={savingDevice} onClick={deleteSelectedDevice}>Remove from plan</button>
              </form>
            </aside>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">SF</div>
          <div>
            <p className="eyebrow">FIELD INFRASTRUCTURE PLANNING</p>
            <h1>SiteForge</h1>
          </div>
        </div>
        <div className="top-actions">
          <span className="status">v0.3</span>
          <button className="primary compact" type="button" onClick={() => setShowNewProject(true)}>
            + New Project
          </button>
        </div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="workspace">
        <aside className="project-sidebar">
          <div className="section-heading">
            <div>
              <p className="eyebrow">PROJECTS</p>
              <h2>Your sites</h2>
            </div>
            <span className="count-badge">{projects.length}</span>
          </div>

          <div className="project-list">
            {loading && <div className="empty-card">Loading projects…</div>}
            {!loading && projects.length === 0 && (
              <button className="empty-card interactive" type="button" onClick={() => setShowNewProject(true)}>
                <strong>Create your first project</strong>
                <span>Start with a warehouse, office, studio, or new-build site.</span>
              </button>
            )}
            {projects.map((project) => (
              <button
                type="button"
                key={project.id}
                className={`project-row ${selectedProject?.id === project.id ? 'active' : ''}`}
                onClick={() => openProject(project)}
              >
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.client_name || project.site_address || 'Site survey project'}</span>
                </div>
                <div className="project-meta">
                  <span>{project.plan_count || 0} plans</span>
                  <span>{project.device_count || 0} devices</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="main-panel">
          {!selectedSummary ? (
            <div className="welcome-panel">
              <div className="welcome-copy">
                <p className="eyebrow">PLAN. MAP. DEPLOY.</p>
                <h2>Turn a blueprint into an installation plan.</h2>
                <p>
                  Create a project, upload the building PDF, then use SiteForge on your iPad to place
                  UniFi access points, cameras, racks, drops, and other infrastructure directly on the plan.
                </p>
                <button className="primary" type="button" onClick={() => setShowNewProject(true)}>
                  Create First Project
                </button>
              </div>
              <div className="plan-preview" aria-hidden="true">
                <div className="grid-lines" />
                <span className="pin pin-ap">AP</span>
                <span className="pin pin-camera">CAM</span>
                <span className="pin pin-rack">RACK</span>
                <div className="preview-label">Field-ready blueprint workspace</div>
              </div>
            </div>
          ) : (
            <>
              <div className="project-header">
                <div>
                  <p className="eyebrow">ACTIVE PROJECT</p>
                  <h2>{selectedSummary.name}</h2>
                  <p className="muted">
                    {[selectedSummary.client_name, selectedSummary.site_address].filter(Boolean).join(' · ') || 'Planning'}
                  </p>
                </div>
                <span className="status planning">{selectedSummary.status || 'planning'}</span>
              </div>

              <div className="project-grid">
                <section className="panel upload-panel">
                  <div className="panel-title">
                    <div>
                      <p className="eyebrow">BLUEPRINTS</p>
                      <h3>Upload a plan</h3>
                    </div>
                    <span className="count-badge">{plans.length}</span>
                  </div>

                  <form className="upload-form" onSubmit={uploadPlan}>
                    <label className="file-drop" htmlFor="plan-file">
                      <input
                        id="plan-file"
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setPlanFile(file);
                          if (file && !planName) setPlanName(file.name.replace(/\.pdf$/i, ''));
                        }}
                      />
                      <strong>{planFile ? planFile.name : 'Choose building plan PDF'}</strong>
                      <span>{planFile ? `${(planFile.size / 1024 / 1024).toFixed(1)} MB` : 'Tap here on iPad or select a file from your computer.'}</span>
                    </label>

                    <div className="form-row">
                      <label>
                        Plan name
                        <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Warehouse floor plan" />
                      </label>
                      <label>
                        Floor / area
                        <input value={floorName} onChange={(e) => setFloorName(e.target.value)} placeholder="Floor 1" />
                      </label>
                    </div>

                    <button className="primary" type="submit" disabled={!planFile || uploading}>
                      {uploading ? 'Uploading…' : 'Upload & Open Blueprint'}
                    </button>
                  </form>
                </section>

                <section className="panel plan-list-panel">
                  <div className="panel-title">
                    <div>
                      <p className="eyebrow">PROJECT FILES</p>
                      <h3>Plans</h3>
                    </div>
                  </div>

                  <div className="plans-list">
                    {plans.length === 0 && (
                      <div className="empty-state">
                        <strong>No blueprints yet</strong>
                        <span>Upload the first PDF to begin laying out equipment.</span>
                      </div>
                    )}
                    {plans.map((plan) => (
                      <article className="plan-row" key={plan.id}>
                        <div className="pdf-icon">PDF</div>
                        <div className="plan-info">
                          <strong>{plan.name}</strong>
                          <span>{plan.floor_name || plan.original_filename} · {plan.device_count || 0} devices</span>
                        </div>
                        <div className="plan-actions">
                          <button className="primary compact" type="button" onClick={() => openWorkspace(plan)}>Map</button>
                          <a className="secondary link-button" href={`/api/plans/${plan.id}/file`} target="_blank" rel="noreferrer">PDF</a>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </div>

              <section className="next-step-strip live-feature">
                <div>
                  <p className="eyebrow">FIELD WORKSPACE</p>
                  <strong>Interactive device placement is live</strong>
                </div>
                <span>Open a plan → choose AP / camera / rack → tap the blueprint → save details</span>
              </section>
            </>
          )}
        </section>
      </section>

      {showNewProject && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !saving && setShowNewProject(false)}>
          <form className="modal" onSubmit={createProject} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">NEW SITEFORGE PROJECT</p>
                <h2>Create project</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowNewProject(false)} aria-label="Close">×</button>
            </div>

            <label>
              Project name *
              <input
                autoFocus
                required
                value={projectForm.name}
                onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                placeholder="ABC Distribution Warehouse"
              />
            </label>
            <label>
              Client / company
              <input
                value={projectForm.clientName}
                onChange={(e) => setProjectForm({ ...projectForm, clientName: e.target.value })}
                placeholder="ABC Distribution"
              />
            </label>
            <label>
              Site address
              <input
                value={projectForm.siteAddress}
                onChange={(e) => setProjectForm({ ...projectForm, siteAddress: e.target.value })}
                placeholder="123 Industrial Blvd, Dallas, TX"
              />
            </label>
            <label>
              Notes
              <textarea
                rows="3"
                value={projectForm.description}
                onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                placeholder="New warehouse network and security survey"
              />
            </label>

            <div className="modal-actions">
              <button className="secondary" type="button" onClick={() => setShowNewProject(false)}>Cancel</button>
              <button className="primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Project'}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
