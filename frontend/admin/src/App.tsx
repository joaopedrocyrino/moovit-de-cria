import { APP_NAME } from "@cria/shared";
import { useDocumentTitle } from "@cria/shared/hooks/useDocumentTitle";
import { WelcomePage } from "@cria/shared/pages/WelcomePage";

export default function App() {
  useDocumentTitle(`${APP_NAME} · Admin`);
  return <WelcomePage title="Hello world" />;
}
