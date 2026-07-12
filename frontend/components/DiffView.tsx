const ADDED = "bg-green-950 text-green-300";
const REMOVED = "bg-red-950 text-red-300";
const HEADER = "text-slate-500";

function lineClasses(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
    return HEADER;
  }
  if (line.startsWith("+")) return ADDED;
  if (line.startsWith("-")) return REMOVED;
  return "text-slate-300";
}

export default function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-x-auto">
      {lines.map((line, index) => (
        <div key={index} className={lineClasses(line)}>
          {line || " "}
        </div>
      ))}
    </pre>
  );
}
