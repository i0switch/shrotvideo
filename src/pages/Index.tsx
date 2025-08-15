import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogConsole } from "@/components/LogConsole";
import { useSettings } from "@/hooks/use-settings";
import { Seo } from "@/components/Seo";
import { NavLink } from "react-router-dom";
import { useJobManager } from "@/hooks/use-job-manager";
import { Badge } from "@/components/ui/badge";

const Index = () => {
  const { settings } = useSettings();
  const { status, start, stop, isStarting, isStopping } = useJobManager();
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLogMessage((message: string) => {
      setLogs((prevLogs) => [...prevLogs, message]);
    });
    return () => {
      // unsubscribe(); // Assuming onLogMessage returns an unsubscribe function
    };
  }, []);

  const clearLogs = () => setLogs([]);

  // const runOnce = async () => {
  //   // This function is disabled for now as it calls non-existent APIs.
  // };

  return (
    <div className="container mx-auto p-6 space-y-8">
      <Seo title="ダッシュボード" description="アプリケーションの動作状況を確認し、操作します。" />

      <div className="space-y-2">
        <h1 className="text-2xl font-bold">ダッシュボード</h1>
        <p className="text-muted-foreground">
          監視ジョブの状態を確認し、手動で操作を開始・停止できます。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>自動監視コントロール</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 border rounded-lg">
            <div className="flex-1 space-y-1">
              <h3 className="font-semibold">監視ステータス</h3>
              <div className="flex items-center gap-2">
                {status?.isRunning ? (
                  <Badge variant="success">実行中</Badge>
                ) : (
                  <Badge variant="destructive">停止中</Badge>
                )}
                <p className="text-sm text-muted-foreground">
                  待機中のタスク: {status?.queueSize ?? 0}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={() => start()}
                disabled={status?.isRunning || isStarting}
                size="lg"
              >
                {isStarting ? "開始中..." : "自動監視を開始"}
              </Button>
              <Button 
                variant="destructive"
                onClick={() => stop()}
                disabled={!status?.isRunning || isStopping}
                size="lg"
              >
                {isStopping ? "停止中..." : "停止"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 text-sm">
            <div>
              <div className="text-muted-foreground">出力先</div>
              <div className="font-medium truncate">{settings?.general?.outputPath || "未設定"}</div>
            </div>
            <div>
              <NavLink to="/settings">
                <Button variant="outline">設定を編集</Button>
              </NavLink>
            </div>
            <div className="md:col-span-2 space-y-2">
              <h4 className="font-semibold">監視設定概要</h4>
              {Object.entries(settings?.platforms || {}).map(([platformKey, platformSettings]) => {
                const platformName = {
                  x: 'X',
                  tiktok: 'TikTok',
                  instagram: 'Instagram',
                  youtube: 'YouTube',
                }[platformKey as Platform];
                return (
                  <div key={platformKey} className="flex items-center gap-2">
                    <Badge variant={platformSettings.enabled ? "default" : "secondary"}>
                      {platformName} ({platformSettings.enabled ? "有効" : "無効"})
                    </Badge>
                    {platformSettings.enabled && (
                      <p className="text-sm text-muted-foreground">
                        {platformSettings.accounts.length} アカウント, {platformSettings.intervalMinutes} 分間隔
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="md:col-span-2 space-y-2">
              <h4 className="font-semibold">動画出力設定概要</h4>
              <p className="text-sm text-muted-foreground">
                解像度: {settings?.render.resolution.width}x{settings?.render.resolution.height} |
                長さ: {settings?.render.durationSec}秒 |
                スケール: {settings?.render.scale}
              </p>
              <p className="text-sm text-muted-foreground">
                BGM: {settings?.render.bgmPath ? "設定済み" : "未設定"} |
                背景動画: {settings?.render.backgroundVideoPath ? "設定済み" : "未設定"}
              </p>
              {(settings?.render.captions.top || settings?.render.captions.bottom) && (
                <p className="text-sm text-muted-foreground">
                  テロップ: 上「{settings?.render.captions.top}」下「{settings?.render.captions.bottom}」
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                テロップ背景色: {settings?.render.teleTextBg} |
                品質: {settings?.render.qualityPreset} |
                オーバーレイ位置: {settings?.render.overlayPosition}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <LogConsole logs={logs} onClear={clearLogs} className="min-h-[30vh] h-[40vh] md:h-[50vh] xl:h-[60vh]" />

    </div>
  );
};

export default Index;
