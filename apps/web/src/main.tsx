import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { isStaticPreview } from "./app/build-mode.js";
import { previewView } from "./app/preview-navigation.js";
import "./styles/tokens.css";
import "./styles/scan.css";
import "./styles/report.css";
import "./styles/home-enhancements.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("Missing application root");
const application = createRoot(root);
if (isStaticPreview) {
  let renderGeneration = 0;
  const renderStaticPreview = (): void => {
    const generation = renderGeneration + 1;
    renderGeneration = generation;
    const locale = new URLSearchParams(window.location.search).get("lang") === "zh" ? "zh" : "en";
    const view = previewView(window.location.search, window.location.hash);
    if (view === "sample") {
      void import("./routes/SamplePage.js").then(({ SamplePage }) => {
        if (generation !== renderGeneration || previewView(window.location.search, window.location.hash) !== view) return;
        application.render(<SamplePage locale={locale} />);
      });
      return;
    }
    void import("./routes/PreviewHomePage.js").then(({ PreviewHomePage }) => {
      if (generation !== renderGeneration || previewView(window.location.search, window.location.hash) !== view) return;
      application.render(<PreviewHomePage locale={locale} />);
    });
  };
  window.addEventListener("hashchange", renderStaticPreview);
  window.addEventListener("popstate", renderStaticPreview);
  renderStaticPreview();
} else {
  // The browser router is only initialized for the local/live application.
  void import("./app/router.js").then(({ router }) => {
    application.render(<RouterProvider router={router} />);
  });
}
