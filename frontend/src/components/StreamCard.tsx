import type { ReactNode } from "react";

interface StreamCardProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function StreamCard({
  title,
  description,
  children,
  footer,
}: StreamCardProps) {
  return (
    <section className="glass-panel overflow-hidden">
      <div className="border-b border-white/10 px-5 py-4 sm:px-6">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-white/64">{description}</p>
      </div>
      <div className="p-4 sm:p-6">{children}</div>
      {footer ? (
        <div className="border-t border-white/10 px-5 py-4 sm:px-6">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
