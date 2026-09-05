import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { isStaticPreview } from "./app/build-mode.js";
import "./styles/tokens.css";
import "./styles/scan.css";
import "./styles/report.css";
import "./styles/home-enhancements.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("Missing application root");
const application = createRoot(root);
if (isStaticPreview) {
  const locale = new URLSearchParams(window.location.search).get("lang") === "zh" ? "zh" : "en";
  void import("./routes/SamplePage.js").then(({ SamplePage }) => {
    application.render(<SamplePage locale={locale} />);
  });
} else {
  // The browser router is only initialized for the local/live application.
  void import("./app/router.js").then(({ router }) => {
    application.render(<RouterProvider router={router} />);
  });
}
