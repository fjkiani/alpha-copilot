/**
 * CoverPage — Stealth cover mode
 * Shown when ESC is pressed or window loses focus (auto-stealth).
 * Looks like a boring meeting notes page.
 */
export default function CoverPage() {
  return (
    <div className="min-h-screen bg-white text-gray-800 p-12 font-sans">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold text-gray-700">Meeting Notes</h1>
        <div className="space-y-3 text-gray-500 text-sm">
          <p>Date: {new Date().toLocaleDateString()}</p>
          <p>Attendees: —</p>
          <p>Agenda: —</p>
        </div>
        <div className="border-t border-gray-200 pt-6 space-y-4">
          <div className="h-4 bg-gray-100 rounded w-3/4" />
          <div className="h-4 bg-gray-100 rounded w-1/2" />
          <div className="h-4 bg-gray-100 rounded w-2/3" />
          <div className="h-4 bg-gray-100 rounded w-5/6" />
          <div className="h-4 bg-gray-100 rounded w-1/3" />
        </div>
        <p className="text-xs text-gray-300 pt-8">Press ESC to return</p>
      </div>
    </div>
  );
}
