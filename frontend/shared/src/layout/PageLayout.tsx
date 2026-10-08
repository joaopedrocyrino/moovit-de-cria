import type { ComponentPropsWithoutRef } from "react";
import styles from "./PageLayout.module.css";

export function PageLayout({
  className,
  ...props
}: ComponentPropsWithoutRef<"main">) {
  return (
    <main
      {...props}
      className={[styles.page, className].filter(Boolean).join(" ")}
    />
  );
}
