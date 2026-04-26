import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import "./styles.css";
import App from "./app.tsx";
import { installAdminAuthFetchPatch } from "./lib/admin-auth";

installAdminAuthFetchPatch();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Router base="/dashboard">
			<App />
		</Router>
	</StrictMode>,
);
