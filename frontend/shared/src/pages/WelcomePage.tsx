import { Heading } from "../components/Heading";
import { PageLayout } from "../layout/PageLayout";
import styles from "./WelcomePage.module.css";

type WelcomePageProps = {
  title: string;
};

export function WelcomePage({ title }: WelcomePageProps) {
  return (
    <PageLayout>
      <div className={styles.content}>
        <Heading>{title}</Heading>
      </div>
    </PageLayout>
  );
}
