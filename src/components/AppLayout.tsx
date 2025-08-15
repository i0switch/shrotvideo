
import { Film } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const currentPath = location.pathname;

  const navItems = [
    { title: "ダッシュボード", url: "/" },
    { title: "設定", url: "/settings" },
    { title: "ヘルプ", url: "/help" },
  ];

  const isActive = (path: string) => currentPath === path;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 h-14 flex items-center border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/40">
        <div className="w-full px-4 md:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-primary" />
            <span className="text-sm sm:text-base font-semibold">アダアフィ用ショート動画支援アプリ（仮）</span>
          </div>
          
          <nav className="flex gap-1">
            {navItems.map((item) => (
              <Link
                key={item.url}
                to={item.url}
                className={`px-3 py-2 text-sm rounded-md transition-colors ${
                  isActive(item.url)
                    ? "bg-primary text-primary-foreground font-medium"
                    : "hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {item.title}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
