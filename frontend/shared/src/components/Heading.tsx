import type { ComponentPropsWithoutRef } from "react";
import styles from "./Heading.module.css";

export function Heading({
  className,
  ...props
}: ComponentPropsWithoutRef<"h1">) {
  return (
    <h1
      {...props}
      className={[styles.heading, className].filter(Boolean).join(" ")}
    />
  );
}
