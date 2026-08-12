import { useEffect, useMemo, useState } from 'react';

const emptyProject = {
  name: '',
  clientName: '',
  siteAddress: '',
  description: '',
};

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

  const selectedSummary = useMemo(() => {
    if (!selectedProject) return null;
    return projects.find((project) => project.id === selectedProject.id) || selectedProject;
  }, [projects, selectedProject]);

  useEffect(() => {
    loadProjects();
  }, []);

  async function api(path, options) {
    const response = await fetch(path, options);
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

      await api(`/api/projects/${encodeURIComponent(selectedProject.id)}/plans`, {
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
      setMessage('Blueprint uploaded successfully.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
    }
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
          <span className="status">v0.2</span>
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
                      {uploading ? 'Uploading…' : 'Upload Blueprint'}
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
                          <span>{plan.floor_name || plan.original_filename}</span>
                        </div>
                        <a className="secondary link-button" href={`/api/plans/${plan.id}/file`} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      </article>
                    ))}
                  </div>
                </section>
              </div>

              <section className="next-step-strip">
                <div>
                  <p className="eyebrow">NEXT SITEFORGE MILESTONE</p>
                  <strong>Interactive blueprint workspace</strong>
                </div>
                <span>Tap plan → place AP / camera / rack → save coordinates</span>
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
              <button className="icon-button" type="button" onClick={() => setShowNewProject(false)} aria-label="Close">
                ×
              </button>
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
