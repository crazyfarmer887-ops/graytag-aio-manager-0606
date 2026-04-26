import { Route, Switch, useLocation } from "wouter";
import { Provider } from "./components/provider";
import { ErrorBoundary } from "./components/error-boundary";
import { AgentFeedback } from "@runablehq/website-runtime";
import HomePage from "./pages/home";
import PricePage from "./pages/price";
import MyAccountPage from "./pages/my-account";
import ManagePage from "./pages/manage";
import WritePage from "./pages/write";
import ProfitPage from "./pages/profit";
import ChatPage from "./pages/chat";
import EditPricePage from "./pages/edit-price";
import PartyInfoPage from "./pages/party-info";
import BottomNav from "./components/bottom-nav";
import AdminTokenControl from "./components/admin-token-control";
import "./styles.css";

// ErrorBoundary로 감싼 named 래퍼들 (인라인 화살표 함수 X)
const HomeWrapped    = () => <ErrorBoundary><HomePage /></ErrorBoundary>;
const PriceWrapped   = () => <ErrorBoundary><PricePage /></ErrorBoundary>;
const ManageWrapped  = () => <ErrorBoundary><ManagePage /></ErrorBoundary>;
const ProfitWrapped  = () => <ErrorBoundary><ProfitPage /></ErrorBoundary>;
const WriteWrapped   = () => <ErrorBoundary><WritePage /></ErrorBoundary>;
const ChatWrapped    = () => <ErrorBoundary><ChatPage /></ErrorBoundary>;
const EditWrapped    = () => <ErrorBoundary><EditPricePage /></ErrorBoundary>;
const PartyWrapped   = () => <ErrorBoundary><PartyInfoPage /></ErrorBoundary>;
const MyWrapped      = () => <ErrorBoundary><MyAccountPage /></ErrorBoundary>;

function App() {
  const [location] = useLocation();
  const isChat = location === "/chat";

  return (
    <Provider>
      <div style={{ paddingTop: isChat ? 0 : 52 }}>
        <Switch>
          <Route path="/"              component={HomeWrapped} />
          <Route path="/price/:category?" component={PriceWrapped} />
          <Route path="/manage"        component={ManageWrapped} />
          <Route path="/profit"        component={ProfitWrapped} />
          <Route path="/write"         component={WriteWrapped} />
          <Route path="/chat"          component={ChatWrapped} />
          <Route path="/edit-price"    component={EditWrapped} />
          <Route path="/party-info"    component={PartyWrapped} />
          <Route path="/my"            component={MyWrapped} />
        </Switch>
      </div>
      <AdminTokenControl />
      {!isChat && <BottomNav />}
      {import.meta.env.DEV && <AgentFeedback />}
    </Provider>
  );
}

export default App;
