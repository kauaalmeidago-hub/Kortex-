import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import WhatsAppCardPage from "./pages/WhatsAppCardPage";
import "./index.css";

import { installRecoveryTracking } from "./features/auth/recovery";

const isCardAccess=window.location.pathname==='/koa/carteirinha';
const stopRecoveryTracking = isCardAccess?()=>undefined:installRecoveryTracking();
if (import.meta.hot) import.meta.hot.dispose(stopRecoveryTracking);

createRoot(document.getElementById("root")!).render(isCardAccess?<WhatsAppCardPage />:<App />);
