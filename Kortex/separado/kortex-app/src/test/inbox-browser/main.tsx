import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import InboxPage from "@/pages/InboxPage";
import "@/index.css";
import "./fixture";
import "./test-frame.css";

// Only this test entry point mounts the production inbox with test-only aliases.
// It is never referenced by the application entry point or production routing.
createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/inbox"]}>
    <div className="inbox-test-frame"><InboxPage /></div>
  </MemoryRouter>,
);
