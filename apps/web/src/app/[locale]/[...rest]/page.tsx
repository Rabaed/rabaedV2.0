import { notFound } from "next/navigation";

/** A URL that matches no route is a 404 like any other, shown by the locale's one not-found page. */
export default function UnknownPage() {
  notFound();
}
