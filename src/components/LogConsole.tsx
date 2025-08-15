import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";

interface LogConsoleProps {
  logs: string[];
  onClear?: () => void;
  className?: string;
}

export const LogConsole = ({ logs, onClear, className }: LogConsoleProps) => {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <Card className={"h-full overflow-hidden border bg-card/60 backdrop-blur " + (className ?? "") }>
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm text-muted-foreground">動作状況ログ</span>
          {onClear && (
            <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">
              クリア
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed space-y-1">
          {logs.length === 0 ? (
            <div className="text-muted-foreground">ログはまだありません。</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="text-muted-foreground">
                {l}
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      </div>
    </Card>
  );
};
