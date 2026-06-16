import { useState } from "react";
import { ChevronDown } from "lucide-react";

// Generic accordion section. Mirrors the inline expandable pattern used in
// ClusterStatus (border + chevron + slide-down body) so the dashboard's
// "Cluster Health" wrapper looks at home next to the existing per-section
// expanders it contains.
export default function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex justify-between items-center px-6 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div>
          <h2 className="m-0 text-lg text-gray-800 font-semibold">{title}</h2>
          {subtitle && (
            <p className="m-0 text-sm text-gray-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        <ChevronDown
          className={`w-5 h-5 text-gray-400 transform transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="px-6 pb-6 pt-2 border-t border-gray-100">{children}</div>}
    </section>
  );
}
