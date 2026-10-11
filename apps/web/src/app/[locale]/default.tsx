import { notFound } from "next/navigation";

/** The page itself (the implicit `children` slot) when its state can't be recovered: not found. */
export default function Default() {
  notFound();
}
