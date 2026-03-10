import React from "react";
import { useNavigate } from "react-router-dom";

const switchButtonStyle = (active) => ({
  border: "1px solid #d5d7dc",
  background: active ? "#111827" : "#ffffff",
  color: active ? "#ffffff" : "#111827",
  borderRadius: "999px",
  padding: "8px 12px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: active ? "default" : "pointer",
});

const TABS = [
  { key: "dashboard", label: "Dashboard", path: "/dashboard" },
  { key: "analysis", label: "Nouvelle analyse", path: "/analysis" },
  { key: "chat", label: "Chat LLM", path: "/chatpage" },
];

const WorkspaceTabs = ({ active, right = 24, zIndex = 1000 }) => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right,
        zIndex,
        display: "flex",
        gap: 8,
        background: "rgba(255,255,255,0.92)",
        border: "1px solid #e5e7eb",
        borderRadius: 999,
        padding: 6,
        boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
        backdropFilter: "blur(6px)",
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            style={switchButtonStyle(isActive)}
            onClick={isActive ? undefined : () => navigate(tab.path)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

export default WorkspaceTabs;
