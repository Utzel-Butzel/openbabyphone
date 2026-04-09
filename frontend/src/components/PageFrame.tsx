import clsx from "clsx";
import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  { to: "/", label: "Overview", end: true },
  { to: "/baby", label: "Baby Device" },
  { to: "/parent", label: "Parent Device" },
];

export function PageFrame() {
  return (
    <div className="relative overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="glass-panel sticky top-4 z-20 mb-6 flex flex-col gap-5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow mb-2">Joschas OpenBabyPhone</p>
            <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">
              Browser-based baby monitor with direct WebRTC streaming.
            </h1>
          </div>
          <nav className="flex flex-wrap gap-2">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                end={item.end}
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    "rounded-full px-4 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-white text-slate-950"
                      : "bg-white/6 text-white/78 hover:bg-white/12 hover:text-white",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
