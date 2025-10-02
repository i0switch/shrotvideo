import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogConsole } from "@/components/LogConsole";
import { useSettings } from "@/hooks/use-settings";
import { Seo } from "@/components/Seo";
import { NavLink } from "react-router-dom";
import { useJobManager } from "@/hooks/use-job-manager";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { Platform } from "@/core/settings";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const Index = () => {
  const { settings } = useSettings();
  const { status, start, stop, isStarting, isStopping } = useJobManager();
  const [logs, setLogs] = useState<string[]>([]);
  const [testRunning, setTestRunning] = useState(false);
  const [testProgress, setTestProgress] = useState<{ totalAccounts: number; attempted: number; processed: number } | null>(null);

  useEffect(() => {
    // Only subscribe to logs if the electronAPI is available.
    if (window.electronAPI && typeof window.electronAPI.onLogMessage === 'function') {
      const unsubscribe = window.electronAPI.onLogMessage((message: string) => {
        // Keep the log array from getting too large in memory
        setLogs((prevLogs) => [...prevLogs.slice(-200), message]);
      });

      // Cleanup the listener when the component unmounts
      return () => {
        if (unsubscribe) {
          unsubscribe();
        }
      };
    }
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
                <Badge variant={status?.isRunning ? "default" : "destructive"}>
                  {status?.isRunning ? '実行中' : '停止中'}
                </Badge>
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

          {/* テスト実行の簡易進捗表示（各プラットフォーム最新3件・重複可） */}
          <div className="p-4 border rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">テスト処理（各プラットフォーム最新3件・重複可）</h3>
              <Button
                onClick={async () => {
                  if (testRunning) return;
                  setTestRunning(true);
                  setTestProgress({ totalAccounts: 0, attempted: 0, processed: 0 });
                  try {
                    const res = await window.electronAPI.testProcessAllOnce();
                    if (res.ok) {
                      setTestProgress(res.summary!);
                    } else {
                      setTestProgress(null);
                    }
                  } catch {
                    setTestProgress(null);
                  } finally {
                    setTestRunning(false);
                  }
                }}
                disabled={testRunning}
              >{testRunning ? '実行中...' : '全アカウントで実行'}</Button>
            </div>
            {testRunning && (
              <div className="space-y-2">
                {/* 簡易プログレス（目標= totalAccounts * 3 とみなす） */}
                <Progress value={ testProgress ? Math.min(100, Math.round(((testProgress.attempted||0) / Math.max(1, (testProgress.totalAccounts||0) * 3)) * 100)) : 10 } />
                <p className="text-xs text-muted-foreground">実行中...</p>
              </div>
            )}
            {!testRunning && testProgress && (
              <p className="text-xs text-muted-foreground">
                実行結果: 対象 {testProgress.totalAccounts} / 実行 {testProgress.attempted} / 処理 {testProgress.processed}
              </p>
            )}
          </div>

          {/* 新規: プラットフォーム別テスト（件数指定） */}
          <PlatformTestRunner />

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
              {Object.entries(settings?.platforms || {})
                .filter(([k]) => (['x','tiktok','youtube'] as string[]).includes(k))
                .map(([platformKey, platformSettings]) => {
                  const platformName = {
                    x: 'X',
                    tiktok: 'TikTok',
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
              <p className="text-sm text-muted-foreground">
                品質: {settings?.render.qualityPreset} |
                オーバーレイ位置: {settings?.render.overlayPosition}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <LogConsole logs={logs} onClear={clearLogs} className="min-h-[30vh] h-[40vh] md:h-[50vh] xl:h-[60vh]" />

      {/* 最近の生成結果（.meta.json） */}
      <RecentOutputs />

    </div>
  );
};

export default Index;

// 補助コンポーネント: プラットフォーム別テスト実行（件数指定）
function PlatformTestRunner() {
  const [platform, setPlatform] = useState<Platform>('x');
  const [count, setCount] = useState<number>(3);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ totalAccounts: number; attempted: number; processed: number } | null>(null);
  return (
    <div className="p-4 border rounded-lg space-y-3">
      <h3 className="font-semibold">プラットフォーム別テスト生成</h3>
      <div className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">プラットフォーム</span>
          <Select value={platform} onValueChange={(v: Platform) => setPlatform(v)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="選択" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="x">X</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
              <SelectItem value="youtube">YouTube</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">件数</span>
          <Input type="number" className="w-24" min={1} max={10} value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
        </div>
        <div className="flex-1" />
        <Button disabled={running} onClick={async () => {
          if (running) return;
          setRunning(true); setResult(null);
          try {
            const res = await window.electronAPI.testProcessPlatform(platform, count);
            if (res.ok) setResult(res.summary!);
          } finally { setRunning(false); }
        }}>{running ? '実行中...' : 'この条件で実行'}</Button>
      </div>
      {result && (
        <p className="text-xs text-muted-foreground">結果: 対象 {result.totalAccounts} / 実行 {result.attempted} / 処理 {result.processed}</p>
      )}
      <p className="text-xs text-muted-foreground">注: Xでは可能な場合、tweetの動画をダウンロードして記事スクショの動画領域にはめ込み合成します（captureapp経路）。</p>
    </div>
  );
}

function RecentOutputs() {
  const [items, setItems] = useState<Array<{ metaPath: string; videoPath?: string; mtime: number; sourceType?: string; platform?: string; classification?: string; ts?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (!window.electronAPI?.listRecentOutputs) return;
    setLoading(true);
    try {
      const list = await window.electronAPI.listRecentOutputs(20);
      setItems(list || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>最近の生成結果（観測）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>{loading ? '更新中...' : '更新'}</Button>
          <span className="text-xs text-muted-foreground">.meta.json を読み取り、captureapp オーバーレイ使用の有無を確認できます</span>
        </div>
        <div className="space-y-1 text-xs">
          {items.length === 0 && <div className="text-muted-foreground">表示できる結果がありません</div>}
          {items.map((it) => (
            <div key={it.metaPath} className="p-2 border rounded-md">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={it.sourceType === 'x_tweet_overlay' ? 'default' : 'secondary'}>
                  {it.sourceType || 'unknown'}
                </Badge>
                {it.platform && <Badge variant="outline">{it.platform}</Badge>}
                {it.classification && <Badge variant="outline">{it.classification}</Badge>}
                <span className="text-muted-foreground">{new Date(it.mtime).toLocaleString()}</span>
              </div>
              <div className="truncate">video: {it.videoPath || '-'}</div>
              <div className="truncate text-muted-foreground">meta: {it.metaPath}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
