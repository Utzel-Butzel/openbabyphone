import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { PageFrame } from "./components/PageFrame";
import { BabyPage } from "./pages/BabyPage";
import { HomePage } from "./pages/HomePage";
import { ParentPage } from "./pages/ParentPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: <PageFrame />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "baby",
        element: <BabyPage />,
      },
      {
        path: "parent",
        element: <ParentPage />,
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
