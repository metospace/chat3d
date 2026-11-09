import './webmcp';
import React from "react";
import ReactDOM from "react-dom/client";
const App=React.lazy(()=>import('./App'));
const TeamOAuthCallback=React.lazy(()=>import('./team-web/TeamOAuthCallback'));
import {startAppUpdateChecks} from "./domain/appUpdateClient";
import "./index.css";
const callback=/\/team\/sso\/callback\/?$/.test(window.location.pathname);
if(!callback)startAppUpdateChecks();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <React.Suspense fallback={<p role="status">正在载入 Scenivo…</p>}>
      {callback?<TeamOAuthCallback/>:<App/>}
    </React.Suspense>
  </React.StrictMode>,
);
