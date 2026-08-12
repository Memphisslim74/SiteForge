const projectCards = [
  { name: 'Warehouse Survey', detail: 'Ready for your first blueprint' },
  { name: 'Field Mode', detail: 'Designed for iPad site walks' },
  { name: 'Plan Output', detail: 'Save and export marked-up plans' },
];

export default function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">FIELD INFRASTRUCTURE PLANNING</p>
          <h1>SiteForge</h1>
        </div>
        <span className="status">v0.1</span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">PLAN. MAP. DEPLOY.</p>
          <h2>Build your IT plan directly on the blueprint.</h2>
          <p className="lede">
            Upload a building layout, walk the site with your iPad, place UniFi devices,
            save the markup, and bring a clean plan back to the office.
          </p>
          <div className="actions">
            <button type="button" className="primary">New Project</button>
            <button type="button" className="secondary">Open Projects</button>
          </div>
        </div>

        <div className="plan-preview" aria-label="Blueprint preview placeholder">
          <div className="grid-lines" />
          <span className="pin pin-ap">AP</span>
          <span className="pin pin-camera">CAM</span>
          <span className="pin pin-rack">RACK</span>
          <div className="preview-label">Blueprint workspace coming next</div>
        </div>
      </section>

      <section className="cards">
        {projectCards.map((card) => (
          <article className="card" key={card.name}>
            <h3>{card.name}</h3>
            <p>{card.detail}</p>
          </article>
        ))}
      </section>

      <footer>
        SiteForge foundation is live. Blueprint upload, device placement, and Cloudflare storage are next.
      </footer>
    </main>
  );
}
