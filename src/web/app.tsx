import { lazy, Suspense } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Provider } from "./components/provider";
import { ErrorBoundary } from "./components/error-boundary";
import { AgentFeedback } from "@runablehq/website-runtime";
import BottomNav from "./components/bottom-nav";
import AdminTokenControl from "./components/admin-token-control";
import "./styles.css";

const HomePage = lazy(() => import("./pages/home"));
const PricePage = lazy(() => import("./pages/price"));
const MyAccountPage = lazy(() => import("./pages/my-account"));
const ManagePage = lazy(() => import("./pages/manage"));
const WritePage = lazy(() => import("./pages/write"));
const ProfitPage = lazy(() => import("./pages/profit"));
const ChatPage = lazy(() => import("./pages/chat"));
const EditPricePage = lazy(() => import("./pages/edit-price"));
const PartyInfoPage = lazy(() => import("./pages/party-info"));
const PartyAccessPage = lazy(() => import("./pages/party-access"));

const RouteFallback = () => (
  <div style={{ padding: 20, color: '#7C3AED', fontSize: 13, fontWeight: 900 }}>대시보드 불러오는 중...</div>
);

// ErrorBoundary로 감싼 named 래퍼들 (인라인 화살표 함수 X)
const HomeWrapped    = () => <ErrorBoundary><HomePage /></ErrorBoundary>;
const PriceWrapped   = () => <ErrorBoundary><PricePage /></ErrorBoundary>;
const ManageWrapped  = () => <ErrorBoundary><ManagePage /></ErrorBoundary>;
const ProfitWrapped  = () => <ErrorBoundary><ProfitPage /></ErrorBoundary>;
const WriteWrapped   = () => <ErrorBoundary><WritePage /></ErrorBoundary>;
const ChatWrapped    = () => <ErrorBoundary><ChatPage /></ErrorBoundary>;
const EditWrapped    = () => <ErrorBoundary><EditPricePage /></ErrorBoundary>;
const PartyWrapped   = () => <ErrorBoundary><PartyInfoPage /></ErrorBoundary>;
const AccessWrapped  = () => <ErrorBoundary><PartyAccessPage /></ErrorBoundary>;
const MyWrapped      = () => <ErrorBoundary><MyAccountPage /></ErrorBoundary>;

function App() {
  const [location] = useLocation();
  const isChat = location === "/chat";
  const isAccess = location.startsWith("/access/") || location.startsWith("/dashboard/access/");

  return (
    <Provider>
      <div style={{ paddingTop: (isChat || isAccess) ? 0 : 52 }}>
        <Suspense fallback={<RouteFallback />}>
          <Switch>
            <Route path="/"              component={HomeWrapped} />
            <Route path="/price/:category?" component={PriceWrapped} />
            <Route path="/manage"        component={ManageWrapped} />
            <Route path="/profit"        component={ProfitWrapped} />
            <Route path="/write"         component={WriteWrapped} />
            <Route path="/chat"          component={ChatWrapped} />
            <Route path="/edit-price"    component={EditWrapped} />
            <Route path="/party-info"    component={PartyWrapped} />
            <Route path="/access/:token"  component={AccessWrapped} />
            <Route path="/dashboard/access/:token" component={AccessWrapped} />
            <Route path="/my"            component={MyWrapped} />
          </Switch>
        </Suspense>
      </div>
      {!isAccess && <AdminTokenControl />}
      {!isChat && !isAccess && <BottomNav />}
      {import.meta.env.DEV && <AgentFeedback />}
    </Provider>
  );
}

export default App;
