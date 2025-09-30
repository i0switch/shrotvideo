import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { Seo } from "@/components/Seo";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Platform, Account, WatchedFolder } from "@/core/settings";
import { Trash2 } from "lucide-react";
import { useState, useEffect, useRef } from "react"; // Add useEffect
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const Settings = () => {
  const { settings, isLoading, isError, error, updateSettings, isUpdating } = useSettings();
  const [newAccounts, setNewAccounts] = useState<Record<Platform, string>>({
    x: '',
    tiktok: '',
    youtube: '',
  });

  // テロップ機能削除に伴いローカル編集状態は不要

  // テスト用動画パス（背景動画とは独立して管理）
  // フォールバックは実行時に settings.render.backgroundVideoPath を参照するため、
  // 初期同期は行わない（背景動画変更時に自動で追従できるようにする）。
  const [testVideoPath, setTestVideoPath] = useState<string>('');

  // New: State for login cookies per platform (X/YouTube)
  const [cookieSaved, setCookieSaved] = useState<Record<'x'|'youtube', boolean>>({ x: false, youtube: false });

  // Copilot Agent: 公式ログイン画面を表示する関数
  const refreshPlatformStatus = async (platform: 'x'|'youtube') => {
    try {
      const ok = await window.auth.status(platform);
      setCookieSaved(prev => ({ ...prev, [platform]: !!ok }));
    } catch {
      // ignore
    }
  };

  // 初回取得確認ダイアログの状態
  const [confirmInit, setConfirmInit] = useState<{ open: boolean; platform: Platform | null; accountId: string }>({ open: false, platform: null, accountId: '' });

  const handlePlatformLogin = async (platform: 'x'|'youtube') => {
    if (window.auth && window.auth.login) {
      window.auth.login(platform);
      toast({ title: `${platform}公式ログイン画面を表示しました`, description: 'ID/パスワード/2FAを入力してください。成功すると自動で閉じます。' });
      // Poll status a few times after 3s to detect save
      setTimeout(async () => {
        for (let i = 0; i < 6; i++) {
          await refreshPlatformStatus(platform);
          await new Promise(r => setTimeout(r, 800));
        }
      }, 3000);
    } else {
      toast({ title: 'エラー', description: 'ログインAPIが利用できません。', variant: 'destructive' });
    }
  };


  const handleSelectFile = async (key: 'bgmPath' | 'backgroundVideoPath') => {
    try {
      const filters = key === 'bgmPath'
        ? [{ name: 'Audio', extensions: ['mp3','wav','aac','m4a'] }]
        : [{ name: 'Videos', extensions: ['mp4','mov','avi','mkv','webm'] }];
      const result = (window.files && window.files.pickFile)
        ? await window.files.pickFile(key === 'bgmPath' ? 'bgm' : key === 'backgroundVideoPath' ? 'backgroundVideo' : 'fontFile', filters)
  : await window.electronAPI.openFileDialog();
      if (result && settings) {
        updateSettings({ render: { ...settings.render, [key]: result } });
        toast({ title: "ファイルが選択されました", description: result });
      } else if (result === null) {
        toast({ title: '選択がキャンセルされました', description: 'ダイアログが閉じられたか、権限で拒否されました。' });
      }
    } catch (e) {
      console.error('[select-file] failed', e);
      toast({ title: '選択に失敗しました', description: (e as Error)?.message || String(e), variant: 'destructive' });
    }
  };

  // テスト用動画の選択（設定には保存しない）
  const handleSelectTestVideo = async () => {
    try {
      const filters = [{ name: 'Videos', extensions: ['mp4','mov','avi','mkv','webm'] }];
      const result = (window.files && window.files.pickFile)
        ? await window.files.pickFile('testVideo', filters)
        : await window.electronAPI.openFileDialog();
      if (result) {
        setTestVideoPath(result);
        toast({ title: 'テスト用動画を選択しました', description: result });
      } else if (result === null) {
        toast({ title: '選択がキャンセルされました', description: 'ダイアログが閉じられました。' });
      }
    } catch (e) {
      console.error('[select-test-video] failed', e);
      toast({ title: '選択に失敗しました', description: (e as Error)?.message || String(e), variant: 'destructive' });
    }
  };

  const handleSelectDirectory = async () => {
    const result = (window.files && window.files.pickFolder)
      ? await window.files.pickFolder('outputDir')
      : await window.electronAPI.openDirectoryDialog();
    if (result && settings) {
      updateSettings({ general: { ...settings.general, outputPath: result } });
      toast({ title: "出力先が更新されました", description: result });
    }
  };

  // Watched folders UI helpers
  const addWatchedFolder = async () => {
    const result = (window.files && window.files.pickFolder) ? await window.files.pickFolder('watchedFolder') : await window.electronAPI.openDirectoryDialog();
    if (!result || !settings) return;
    const exists = (settings.general.watchedFolders || []).some(f => f.path === result);
    if (exists) {
      toast({ title: '既に追加済み', description: result });
      return;
    }
    const wf: WatchedFolder = { path: result, isActive: true, intervalMinutes: 5, chromaMode: 'none' };
    updateSettings({ general: { ...settings.general, watchedFolders: [ ...(settings.general.watchedFolders || []), wf ] } });
    toast({ title: '監視フォルダを追加しました', description: result });
  };
  const updateWatchedFolder = (idx: number, patch: Partial<WatchedFolder>) => {
    if (!settings) return;
    const list = [...(settings.general.watchedFolders || [])];
    const next = { ...list[idx], ...patch } as WatchedFolder;
    list[idx] = next;
    updateSettings({ general: { ...settings.general, watchedFolders: list } });
  };
  const removeWatchedFolder = (idx: number) => {
    if (!settings) return;
    const list = [...(settings.general.watchedFolders || [])];
    const removed = list.splice(idx, 1);
    updateSettings({ general: { ...settings.general, watchedFolders: list } });
    if (removed[0]) toast({ title: '監視フォルダを削除しました', description: removed[0].path });
  };

  const handleAccountChange = (platform: Platform, value: string) => {
    setNewAccounts(prev => ({ ...prev, [platform]: value }));
  };

  const addAccount = (platform: Platform) => {
    const newAccountId = newAccounts[platform].trim();
    if (newAccountId && settings) {
      const currentAccounts = settings.platforms[platform].accounts || [];
      if (currentAccounts.some(acc => acc.id === newAccountId)) {
        toast({ title: "エラー", description: "このアカウントは既に追加されています。", variant: "destructive" });
        return;
      }
      // 初回バックフィル件数は一般設定から反映（UI上書き可能だった旧promptは廃止）
      const backfill = Math.max(0, Math.min(50, Number(settings.general.initialBackfillCount ?? 0)));
  const newAccount: Account = { id: newAccountId, isActive: true, backfillRemaining: backfill, processedIds: [] };
      const updatedAccounts = [...currentAccounts, newAccount];
      updateSettings({
        platforms: {
          ...settings.platforms,
          [platform]: { ...settings.platforms[platform], accounts: updatedAccounts },
        },
      });
      setNewAccounts(prev => ({ ...prev, [platform]: '' }));
  // 確認ダイアログを表示
  setConfirmInit({ open: true, platform, accountId: newAccountId });
  toast({ title: "アカウントが追加されました", description: backfill > 0 ? `初回バックフィル候補: ${backfill}件（確認ダイアログで実行可能）` : 'バックフィルなし' });
    }
  };

  const removeAccount = (platform: Platform, accountId: string) => {
    if (settings) {
      const updatedAccounts = settings.platforms[platform].accounts.filter(acc => acc.id !== accountId);
      updateSettings({
        platforms: {
          ...settings.platforms,
          [platform]: { ...settings.platforms[platform], accounts: updatedAccounts },
        },
      });
      toast({ title: "アカウントが削除されました" });
    }
  };

  const toggleAccountActive = (platform: Platform, accountId: string) => {
    if (settings) {
      const updatedAccounts = settings.platforms[platform].accounts.map(acc =>
        acc.id === accountId ? { ...acc, isActive: !acc.isActive } : acc
      );
      updateSettings({
        platforms: {
          ...settings.platforms,
          [platform]: { ...settings.platforms[platform], accounts: updatedAccounts },
        },
      });
    }
  };

  // New: Credential handling functions
  const handleLogout = async (platform: 'x'|'youtube') => {
    const cleared = await window.auth.clear(platform);
    if (cleared) {
      toast({ title: `${platform}のログイン情報をクリアしました` });
      setCookieSaved(prev => ({ ...prev, [platform]: false }));
    } else {
      toast({ title: 'エラー', description: 'Cookieのクリアに失敗しました。', variant: 'destructive' });
    }
  };

  // Load credentials when platform tab is selected
  const handleTabChange = (value: string) => {
    const platform = value as Platform;
    if (platform === 'x' || platform === 'youtube') {
      refreshPlatformStatus(platform as 'x'|'youtube');
    }
  };

  useEffect(() => {
    // Initial fetch on mount for relevant platforms
    (['x','youtube'] as const).forEach(p => { void refreshPlatformStatus(p); });
  }, []);

  // 設定の変化に追従して表示値を同期
  // テロップ表示設定の同期は削除


  if (isLoading) {
    return <Skeleton className="h-full w-full" />;
  }

  if (isError) {
    return <div>Error loading settings: {error?.message}</div>;
  }

  const renderPlatformSettings = (platform: Platform, name: string) => {
    const platformSettings = settings?.platforms[platform];
    if (!platformSettings) return null;

    return (
      <TabsContent value={platform} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{name} 監視設定</CardTitle>
            <CardDescription>
              {name}からのデータ取得と監視を有効にするか設定します。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
              <div className="space-y-0.5">
                <Label>監視を有効にする</Label>
                <p className="text-xs text-muted-foreground">
                  有効にすると、設定された間隔で{name}の監視を開始します。
                </p>
              </div>
              <Switch
                checked={platformSettings.enabled}
                onCheckedChange={(checked) =>
                  settings && updateSettings({ platforms: { ...settings.platforms, [platform]: { ...platformSettings, enabled: checked } } })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${platform}-interval`}>実行間隔（分）</Label>
              <Input
                id={`${platform}-interval`}
                type="number"
                min={1}
                value={platformSettings.intervalMinutes}
                onChange={(e) => settings && updateSettings({ platforms: { ...settings.platforms, [platform]: { ...platformSettings, intervalMinutes: Number(e.target.value) || 1 } } })}
                disabled={!platformSettings.enabled}
              />
            </div>
            {/* New: Scrape Delay */}
            <div className="space-y-2">
              <Label htmlFor={`${platform}-scrape-delay`}>スクレイピング間隔（ミリ秒）</Label>
              <Input
                id={`${platform}-scrape-delay`}
                type="number"
                min={0}
                value={platformSettings.scrapeDelayMs}
                onChange={(e) => settings && updateSettings({ platforms: { ...settings.platforms, [platform]: { ...platformSettings, scrapeDelayMs: Number(e.target.value) || 0 } } })}
                disabled={!platformSettings.enabled}
              />
              <p className="text-xs text-muted-foreground">
                各アカウントのスクレイピング前に待機する時間（ミリ秒）。レート制限対策。
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>監視対象アカウント</CardTitle>
            <CardDescription>監視する{name}アカウントのリストです。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {platformSettings.accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between rounded-lg border p-3 gap-3">
                <div className="flex items-center gap-4">
                  <Switch checked={account.isActive} onCheckedChange={() => toggleAccountActive(platform, account.id)} />
                  <span className={!account.isActive ? 'text-muted-foreground' : ''}>{account.id}</span>
                </div>
                {/* アカウント単位のクロマキー設定（簡潔表示） */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">クロマキー</Label>
                    <Select
                      value={account.chromaMode || 'none'}
                      onValueChange={(v: 'none'|'image'|'video') => {
                        if (!settings) return;
                        const updated = platformSettings.accounts.map(a => a.id === account.id ? { ...a, chromaMode: v } : a);
                        updateSettings({ platforms: { ...settings.platforms, [platform]: { ...platformSettings, accounts: updated } } });
                      }}
                    >
                      <SelectTrigger className="w-[160px]"><SelectValue placeholder="none" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">なし</SelectItem>
                        <SelectItem value="image">画像</SelectItem>
                        <SelectItem value="video">動画</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* 画像選択（パスは表示しない） */}
                  {account.chromaMode === 'image' && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">画像</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const filters = [{ name: 'Images', extensions: ['png','jpg','jpeg','webp'] }];
                          const result = (window.files && window.files.pickFile)
                            ? await window.files.pickFile('chromaImage', filters)
                            : await window.electronAPI.openFileDialog();
                          if (result && settings) {
                            const updated = platformSettings.accounts.map(a => a.id === account.id ? { ...a, chromaImagePath: result } : a);
                            updateSettings({ platforms: { ...settings.platforms, [platform]: { ...platformSettings, accounts: updated } } });
                            toast({ title: '画像を選択しました' });
                          }
                        }}
                      >選択</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (!settings) return;
                          const updated = platformSettings.accounts.map(a => a.id === account.id ? { ...a, chromaImagePath: '' } : a);
                          updateSettings({ platforms: { ...settings.platforms, [platform]: { ...platformSettings, accounts: updated } } });
                          toast({ title: '画像指定をクリアしました' });
                        }}
                      >クリア</Button>
                      {account.chromaImagePath ? (
                        <Badge variant="default">設定済み</Badge>
                      ) : (
                        <Badge variant="secondary">未指定</Badge>
                      )}
                    </div>
                  )}
                  {/* 動画選択（パスは表示しない） */}
                  {account.chromaMode === 'video' && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">動画</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const filters = [{ name: 'Videos', extensions: ['mp4','mov','mkv','webm'] }];
                          const result = (window.files && window.files.pickFile)
                            ? await window.files.pickFile('chromaVideo', filters)
                            : await window.electronAPI.openFileDialog();
                          if (result && settings) {
                            const updated = platformSettings.accounts.map(a => a.id === account.id ? { ...a, chromaVideoPath: result } : a);
                            updateSettings({ platforms: { ...settings.platforms, [platform]: { ...platformSettings, accounts: updated } } });
                            toast({ title: '動画を選択しました' });
                          }
                        }}
                      >選択</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (!settings) return;
                          const updated = platformSettings.accounts.map(a => a.id === account.id ? { ...a, chromaVideoPath: '' } : a);
                          updateSettings({ platforms: { ...settings.platforms, [platform]: { ...platformSettings, accounts: updated } } });
                          toast({ title: '動画指定をクリアしました' });
                        }}
                      >クリア</Button>
                      {account.chromaVideoPath ? (
                        <Badge variant="default">設定済み</Badge>
                      ) : (
                        <Badge variant="secondary">未指定</Badge>
                      )}
                    </div>
                  )}
                  {/* 注意書き */}
                  {(account.chromaMode === 'image' && !account.chromaImagePath) || (account.chromaMode === 'video' && !account.chromaVideoPath) ? (
                    <p className="text-xs text-muted-foreground">未指定の場合、クロマキー合成は行われません。</p>
                  ) : null}
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeAccount(platform, account.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
             {platformSettings.accounts.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">アカウントがありません。</p>
            )}
          </CardContent>
          <CardFooter className="flex gap-2 border-t pt-6">
            <Input
              placeholder="新しいアカウントIDを追加..."
              value={newAccounts[platform]}
              onChange={(e) => handleAccountChange(platform, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addAccount(platform)}
            />
            <Button onClick={() => addAccount(platform)}>追加</Button>
          </CardFooter>
        </Card>

        {/* ログインUI（X/YouTube） */}
        {(platform === 'x' || platform === 'youtube') && (
          <Card>
            <CardHeader>
              <CardTitle>{name} ログイン</CardTitle>
              <CardDescription>
                一部の取得ではログインが必要になる場合があります。公式ログイン画面で認証するとCookieが保存されます。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">保存状態:</span>
                {cookieSaved[platform as 'x'|'youtube'] ? (
                  <Badge variant="default">ログイン済み</Badge>
                ) : (
                  <Badge variant="secondary">未ログイン</Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handlePlatformLogin(platform as 'x'|'youtube')}>
                  {name}公式ログイン画面を表示
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleLogout(platform as 'x'|'youtube')}
                  disabled={!cookieSaved[platform as 'x'|'youtube']}
                >
                  ログアウト
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-8">
      <Seo title="設定" description="アプリケーションの各種設定を行います。" />

      <div className="space-y-2">
        <h1 className="text-2xl font-bold">設定</h1>
        <p className="text-muted-foreground">
          アプリケーションの各種設定を行います。変更は自動的に保存されます。
          {isUpdating && <span className="ml-2 animate-pulse">保存中...</span>}
        </p>
      </div>

      <Tabs defaultValue="x" className="w-full" onValueChange={handleTabChange}> {/* Add onValueChange */}
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="x">X</TabsTrigger>
          <TabsTrigger value="tiktok">TikTok</TabsTrigger>
          <TabsTrigger value="youtube">YouTube</TabsTrigger>
          <TabsTrigger value="render">動画生成</TabsTrigger>
          <TabsTrigger value="general">一般</TabsTrigger>
        </TabsList>

        {renderPlatformSettings('x', 'X (旧Twitter)')}
        {renderPlatformSettings('tiktok', 'TikTok')}
        {renderPlatformSettings('youtube', 'YouTube')}

        <TabsContent value="render">
          <Card>
            <CardHeader>
              <CardTitle>動画合成設定</CardTitle>
              <CardDescription>生成される動画の見た目や品質を設定します。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-2 items-start">
              {/* 左: 設定 / 右: プレビュー（横配置） */}
              <div className="space-y-4">
                {/* Render settings UI here */}
                <div className="space-y-2">
                <Label>解像度</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="幅"
                    value={settings ? settings.render.resolution.width : ''}
                    onChange={(e) => settings && updateSettings({ render: { ...settings.render, resolution: { ...settings.render.resolution, width: Number(e.target.value) } } })}
                  />
                  <Input
                    type="number"
                    placeholder="高さ"
                    value={settings ? settings.render.resolution.height : ''}
                    onChange={(e) => settings && updateSettings({ render: { ...settings.render, resolution: { ...settings.render.resolution, height: Number(e.target.value) } } })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>動画の長さ（秒）</Label>
                <Input
                  type="number"
                  min={1}
                  value={settings ? settings.render.durationSec : ''}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, durationSec: Number(e.target.value) } })}
                />
              </div>
                <div className="space-y-2">
                <Label>BGM</Label>
                <div className="flex gap-2">
                  <Input value={settings?.render.bgmPath || ''} readOnly placeholder="BGMファイル..." />
                  <Button variant="outline" onClick={() => handleSelectFile('bgmPath')}>選択</Button>
                </div>
              </div>
                <div className="space-y-2">
                <Label>背景動画</Label>
                <div className="flex gap-2">
                  <Input value={settings?.render.backgroundVideoPath || ''} readOnly placeholder="背景動画ファイル..." />
                  <Button variant="outline" onClick={() => handleSelectFile('backgroundVideoPath')}>選択</Button>
                </div>
              </div>
                {/* テロップ関連UIは削除 */}
                <div className="space-y-2">
                <Label>スケール</Label>
                <Input
                  type="number"
                  min={0.1}
                  max={1.0}
                  step={0.1}
                  value={settings ? settings.render.scale : ''}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, scale: Number(e.target.value) } })}
                />
              </div>
                {/* テロップ色のUIは削除 */}
                <div className="space-y-2">
                  <Label>オーバーレイ位置</Label>
                  <Select
                    value={settings?.render.overlayPosition ?? 'center'}
                    onValueChange={(value: 'center' | 'top-center' | 'bottom-center' | 'custom') => settings && updateSettings({ render: { ...settings.render, overlayPosition: value } })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="位置を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="center">中央</SelectItem>
                      <SelectItem value="top-center">上中央</SelectItem>
                      <SelectItem value="bottom-center">下中央</SelectItem>
                      <SelectItem value="custom">カスタム</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* テロップの背景や位置調整UIはすべて撤去 */}
                {/* More render settings can be added here */}
              </div>
              <div className="space-y-2 lg:sticky lg:top-4">
                <Label>プレビュー</Label>
                <RenderPreview />
                <p className="text-xs text-muted-foreground">数値を変更するとプレビューが即座に反映されます（目安）。実際のffmpeg出力と微差がある場合があります。</p>
              </div>
            </CardContent>
          </Card>

          {/* 新規: 合成テストカード */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>動画合成テスト</CardTitle>
              <CardDescription>任意の動画を選び、現在の合成設定で出力を検証します。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 簡易ライブプレビュー（設定の概要） */}
              <div className="rounded-md border p-3 text-xs text-muted-foreground">
                <div>プレビュー（概要）</div>
                <div>解像度: {settings?.render.resolution.width}x{settings?.render.resolution.height} / スケール: {settings?.render.scale}</div>
              </div>
              <div className="space-y-2">
                <Label>テスト用動画</Label>
                <div className="flex gap-2">
                  <Input value={testVideoPath} readOnly placeholder="テスト用動画ファイル..." />
                  <Button variant="outline" onClick={handleSelectTestVideo}>選択</Button>
                </div>
                <p className="text-xs text-muted-foreground">テストはこの動画をソースとして合成します（Xスクショ無し）。背景動画設定とは独立して選択できます。</p>
              </div>
              <div>
                <Button
                  onClick={async () => {
                    // テスト用動画が未選択の場合は背景動画をフォールバックとして使用
                    const fp = testVideoPath || settings?.render.backgroundVideoPath || '';
                    if (!fp) {
                      toast({ title: 'テスト不可', description: 'テスト用動画か背景動画を設定してください。', variant: 'destructive' });
                      return;
                    }
                    try {
                      const out = await window.electronAPI.testGenerate(fp);
                      const srcLabel = testVideoPath ? 'テスト用動画' : '背景動画';
                      toast({ title: '合成テスト完了', description: `${srcLabel}で生成: ${out}` });
                    } catch (e) {
                      const err = e as Error & { message?: string };
                      toast({ title: '合成テスト失敗', description: err?.message || String(e), variant: 'destructive' });
                    }
                  }}
                >
                  合成テストを実行
                </Button>
                <Button
                  variant="outline"
                  className="ml-2"
                  onClick={async () => {
                    // テスト用動画が未選択の場合は背景動画をフォールバックとして使用
                    const fp = testVideoPath || settings?.render.backgroundVideoPath || '';
                    if (!fp) {
                      toast({ title: 'プレビュー不可', description: 'テスト用動画か背景動画を設定してください。', variant: 'destructive' });
                      return;
                    }
                    try {
                      const out = await window.electronAPI.previewGenerate(fp);
                      const srcLabel = testVideoPath ? 'テスト用動画' : '背景動画';
                      toast({ title: 'プレビュー生成完了', description: `${srcLabel}で生成: ${out}` });
                    } catch (e) {
                      const err = e as Error & { message?: string };
                      toast({ title: 'プレビュー生成失敗', description: err?.message || String(e), variant: 'destructive' });
                    }
                  }}
                >
                  1秒プレビュー
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>一般設定</CardTitle>
              <CardDescription>基本的なアプリケーション設定です。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Watched Folders */}
              <div className="space-y-2">
                <Label>フォルダ監視</Label>
                <p className="text-xs text-muted-foreground">指定フォルダに追加された画像・動画を定期的に検出して自動処理します。未指定のクロマ素材は合成しません。</p>
                <div className="space-y-3">
                  {(settings?.general.watchedFolders || []).map((f, idx) => (
                    <div key={f.path} className="flex flex-col gap-2 rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Switch checked={!!f.isActive} onCheckedChange={(v) => updateWatchedFolder(idx, { isActive: v })} />
                          <span className={!f.isActive ? 'text-muted-foreground' : ''}>{f.path}</span>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeWatchedFolder(idx)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                      <div className="grid sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">間隔（分）</Label>
                          <Input type="number" min={1} value={f.intervalMinutes} onChange={(e) => updateWatchedFolder(idx, { intervalMinutes: Math.max(1, Number(e.target.value) || 1) })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">サブフォルダも対象</Label>
                          <div className="flex items-center h-9"><Switch checked={!!f.includeSubfolders} onCheckedChange={(v) => updateWatchedFolder(idx, { includeSubfolders: v })} /></div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">クロマキー</Label>
                          <Select value={f.chromaMode || 'none'} onValueChange={(v: 'none'|'image'|'video') => updateWatchedFolder(idx, { chromaMode: v })}>
                            <SelectTrigger><SelectValue placeholder="選択" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">なし</SelectItem>
                              <SelectItem value="image">画像</SelectItem>
                              <SelectItem value="video">動画</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          {f.chromaMode === 'image' && (
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" onClick={async () => {
                                const filters = [{ name: 'Images', extensions: ['png','jpg','jpeg','webp'] }];
                                const result = (window.files && window.files.pickFile) ? await window.files.pickFile('folderChromaImage', filters) : await window.electronAPI.openFileDialog();
                                if (result) updateWatchedFolder(idx, { chromaImagePath: result });
                              }}>画像選択</Button>
                              <Button variant="ghost" size="sm" onClick={() => updateWatchedFolder(idx, { chromaImagePath: '' })}>クリア</Button>
                              {f.chromaImagePath ? <Badge variant="default">設定済み</Badge> : <Badge variant="secondary">未指定</Badge>}
                            </div>
                          )}
                          {f.chromaMode === 'video' && (
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" onClick={async () => {
                                const filters = [{ name: 'Videos', extensions: ['mp4','mov','mkv','webm'] }];
                                const result = (window.files && window.files.pickFile) ? await window.files.pickFile('folderChromaVideo', filters) : await window.electronAPI.openFileDialog();
                                if (result) updateWatchedFolder(idx, { chromaVideoPath: result });
                              }}>動画選択</Button>
                              <Button variant="ghost" size="sm" onClick={() => updateWatchedFolder(idx, { chromaVideoPath: '' })}>クリア</Button>
                              {f.chromaVideoPath ? <Badge variant="default">設定済み</Badge> : <Badge variant="secondary">未指定</Badge>}
                            </div>
                          )}
                        </div>
                      </div>
                      {((f.chromaMode === 'image' && !f.chromaImagePath) || (f.chromaMode === 'video' && !f.chromaVideoPath)) && (
                        <p className="text-xs text-muted-foreground">未指定の場合、クロマキー合成は行われません。</p>
                      )}
                    </div>
                  ))}
                  <div>
                    <Button variant="outline" onClick={addWatchedFolder}>監視フォルダを追加</Button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3 mt-2">
                    <div className="space-y-1">
                      <Label className="text-xs">処理済みキャッシュ保持時間（時間）</Label>
                      <Input type="number" min={1} value={settings?.general.watchedFoldersRetentionHours ?? 24} onChange={(e) => settings && updateSettings({ general: { ...settings.general, watchedFoldersRetentionHours: Math.max(1, Number(e.target.value) || 24) } })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">処理済みキャッシュ最大件数（合計）</Label>
                      <Input type="number" min={100} value={settings?.general.watchedFoldersMaxCache ?? 2000} onChange={(e) => settings && updateSettings({ general: { ...settings.general, watchedFoldersMaxCache: Math.max(100, Number(e.target.value) || 2000) } })} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>テスト処理</Label>
                    <p className="text-xs text-muted-foreground">監視対象の全アカウントから最新の1件のみを取得して動画処理を行います（重複は自動スキップ）。</p>
                  </div>
                  <Button
                    variant="default"
                    onClick={async () => {
                      try {
                        const res = await window.electronAPI.testProcessAllOnce();
                        if (res.ok) {
                          const s = res.summary!;
                          toast({ title: 'テスト処理を実行しました', description: `対象アカウント: ${s.totalAccounts} / 実行: ${s.attempted} / 処理: ${s.processed}` });
                        } else {
                          toast({ title: 'テスト処理に失敗しました', description: res.error || '不明なエラー', variant: 'destructive' });
                        }
                      } catch (e) {
                        const err = e as Error;
                        toast({ title: 'テスト処理エラー', description: err?.message || String(e), variant: 'destructive' });
                      }
                    }}
                  >最新1件を処理</Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="outputPath">本番の動画出力先</Label>
                <div className="flex gap-2">
                  <Input id="outputPath" value={settings?.general.outputPath || ''} readOnly />
                  <Button variant="outline" onClick={handleSelectDirectory}>選択</Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="initialBackfillCount">初回バックフィル件数</Label>
                <Input
                  id="initialBackfillCount"
                  type="number"
                  min={0}
                  max={50}
                  value={settings?.general.initialBackfillCount ?? 0}
                  onChange={(e) => settings && updateSettings({ general: { ...settings.general, initialBackfillCount: Math.max(0, Math.min(50, Number(e.target.value) || 0)) } })}
                />
                <p className="text-xs text-muted-foreground">新規に追加した YouTube / TikTok アカウントの初回監視時に、過去からこの件数だけ保存・加工します。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="diagnosticLogging">診断ログ（詳細状況を定期出力）</Label>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm text-muted-foreground">有効にすると、ジョブ状態や主要設定を一定間隔でログに出力します。</span>
                  <Switch
                    checked={!!settings?.general.diagnosticLogging}
                    onCheckedChange={(checked) => settings && updateSettings({ general: { ...settings.general, diagnosticLogging: checked } })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="diagnosticIntervalSec">診断ログの間隔（秒）</Label>
                <Input
                  id="diagnosticIntervalSec"
                  type="number"
                  min={2}
                  value={settings?.general.diagnosticIntervalSec ?? 10}
                  onChange={(e) => settings && updateSettings({ general: { ...settings.general, diagnosticIntervalSec: Math.max(2, Number(e.target.value) || 10) } })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="testOutputPath">テスト出力先</Label>
                <div className="flex gap-2">
                  <Input id="testOutputPath" value={settings?.general.testOutputPath || ''} readOnly />
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const result = (window.files && window.files.pickFolder)
                        ? await window.files.pickFolder('testOutputDir')
                        : await window.electronAPI.openDirectoryDialog();
                      if (result && settings) {
                        updateSettings({ general: { ...settings.general, testOutputPath: result } });
                        toast({ title: 'テスト出力先が更新されました', description: result });
                      }
                    }}
                  >選択</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {/* 初回取得 確認ダイアログ */}
      <AlertDialog open={confirmInit.open} onOpenChange={(open) => setConfirmInit(prev => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>初回取得を実行しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              新しく追加したアカウントの過去コンテンツを、一般設定の「初回バックフィル件数」に従って保存・加工します。重複は自動的にスキップされます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>いいえ</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const p = confirmInit.platform;
                const id = confirmInit.accountId;
                if (!p || !id) return;
                try {
                  const ok = await window.electronAPI.startInitialFetch(p, id);
                  if (ok) toast({ title: '初回取得を開始しました', description: `${p}: ${id}` });
                  else toast({ title: '初回取得を開始できませんでした', description: 'ログを確認してください', variant: 'destructive' });
                } catch (e) {
                  const err = e as Error;
                  toast({ title: '初回取得エラー', description: err?.message || String(e), variant: 'destructive' });
                }
              }}
            >はい</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// リアルタイムの簡易プレビュー（Canvas）
function RenderPreview() {
  const { settings } = useSettings();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const cfg = settings?.render;
  const width = Math.max(180, Math.min(540, Math.round((cfg?.resolution.width ?? 1080) / 4)));
  const height = Math.max(320, Math.min(960, Math.round((cfg?.resolution.height ?? 1920) / 4)));
  const scale = Math.max(0.05, Math.min(1.0, cfg?.scale ?? 0.8));
  const overlayPos = (cfg?.overlayPosition as 'center'|'top-center'|'bottom-center'|'custom') ?? 'center';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // 背景
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, width, height);

    // 擬似オーバーレイ（スケールと位置のみ）
    const fgW = Math.max(10, Math.min(width, Math.round(width * scale)));
    const fgH = Math.max(10, Math.min(height, Math.round(height * scale)));
    const fgX = Math.round((width - fgW) / 2);
    let fgY: number;
    if (overlayPos === 'top-center') fgY = 0;
    else if (overlayPos === 'bottom-center') fgY = Math.max(0, height - fgH);
    else /* center/custom */ fgY = Math.round((height - fgH) / 2);

    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(fgX, fgY, fgW, fgH);
  }, [width, height, scale, overlayPos]);

  return (
    <div className="rounded-md border bg-background p-3 inline-block">
      <canvas ref={canvasRef} style={{ width: `${width}px`, height: `${height}px` }} />
    </div>
  );
}

export default Settings;
