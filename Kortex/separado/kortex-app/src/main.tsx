import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import { installRecoveryTracking } from "./features/auth/recovery";

const stopRecoveryTracking = installRecoveryTracking();
if (import.meta.hot) import.meta.hot.dispose(stopRecoveryTracking);

createRoot(document.getElementById("root")!).render(<App />);
