import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import ChatWindow from "./components/ChatWindow";
import WorkspaceTabs from "./components/WorkspaceTabs";
import withAuth from "./utils/withauth";
import "./ChatPage.css";

const VideoProcessingPage = () => {
  const location = useLocation();
  const isDashboard = location.pathname === "/dashboard";
  const [selectedSidebarEvent, setSelectedSidebarEvent] = useState(null);

  return (
    <div className="app-container">
      <Sidebar onSelectEvent={setSelectedSidebarEvent} />
      <div className="main-content" style={{ position: "relative" }}>
        <WorkspaceTabs active={isDashboard ? "dashboard" : "analysis"} right={320} zIndex={2000} />
        <ChatWindow
          showLlmPanel={false}
          interfaceMode={isDashboard ? "dashboard" : "analysis"}
          externalSelectedEvent={selectedSidebarEvent}
        />
      </div>
    </div>
  );
};

export default withAuth(VideoProcessingPage, ["admin", "user"]);
