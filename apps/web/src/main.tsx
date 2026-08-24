import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { router } from "./app/router.js";
import "./styles/scan.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("Missing application root");
createRoot(root).render(<RouterProvider router={router} />);
