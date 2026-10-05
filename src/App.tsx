import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Logo from "./components/Logo";
import CollectPage from "./pages/CollectPage";
import DatasetPage from "./pages/DatasetPage";
import DeployPage from "./pages/DeployPage";
import OverviewPage from "./pages/OverviewPage";
import ReviewPage from "./pages/ReviewPage";
import { useStore } from "./sim/store";

const NAV = [
  { to: "/", label: "Overview", step: "" },
  { to: "/collect", label: "Collect", step: "01" },
  { to: "/review", label: "Review", step: "02" },
  { to: "/dataset", label: "Dataset", step: "03" },
  { to: "/deploy", label: "Deploy", step: "04" },
];

export default function App() {
  return (
    <div className="app">
      <ScrollToTop />
      <AppBar />
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/collect" element={<CollectPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/dataset" element={<DatasetPage />} />
        <Route path="/deploy" element={<DeployPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer />
    </div>
  );
}

function AppBar() {
  return (
    <header className="app-bar">
      <Logo className="app-logo" />
      <span className="app-title">Vision MLOps Platform</span>
      <span className="demo-chip" title="Every PC, address, image and model in this demo is simulated">
        DEMO
      </span>
      <nav>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
            {n.step && <span className="step">{n.step}</span>}
            {n.label}
          </NavLink>
        ))}
      </nav>
      <Clock />
    </header>
  );
}

function Footer() {
  const { dispatch } = useStore();
  return (
    <footer className="app-foot">
      <span>Built by Minjun Lee · Vision inspection engineering</span>
      <span className="spacer" />
      <button
        onClick={() => {
          if (window.confirm("Reset the demo to its starting state?")) dispatch({ type: "reset" });
        }}
      >
        Reset demo
      </button>
    </footer>
  );
}

/** A new page starts at its top - not at the scroll depth the previous page was left at. */
function ScrollToTop() {
  const { pathname } = useLocation();
  // Braced on purpose: newer Chromium returns a Promise from scrollTo, and an arrow that
  // hands it back gives React a "cleanup" that is not a function.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="app-clock">{now.toLocaleTimeString("en-GB", { hour12: false })}</span>;
}
