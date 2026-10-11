"use client";

import { Button, Icon } from "@rabaed/ui";
import { useEffect } from "react";

/**
 * Download's button on the printable item (RP-409): opens the browser's print, where the viewer saves
 * the PDF. It opens once by itself when the page has loaded, its fonts included. Not printed itself.
 */
export function PrintNow({ label }: { label: string }) {
  useEffect(() => {
    let done = false;
    void document.fonts.ready.then(() => {
      if (!done) window.print();
    });
    return () => {
      done = true;
    };
  }, []);
  return (
    <Button variant="secondary" data-print-hide="" onClick={() => window.print()}>
      <Icon name="download" />
      {label}
    </Button>
  );
}
