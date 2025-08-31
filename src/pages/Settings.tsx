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
import type { Platform, Account } from "@/core/settings";
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

  // ローカル編集用（テロップ高さ）
  const [topHeightStr, setTopHeightStr] = useState<string>('');
  const [bottomHeightStr, setBottomHeightStr] = useState<string>('');

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


  const handleSelectFile = async (key: 'bgmPath' | 'backgroundVideoPath' | 'fontFilePath') => {
    try {
      const filters = key === 'bgmPath'
        ? [{ name: 'Audio', extensions: ['mp3','wav','aac','m4a'] }]
        : key === 'backgroundVideoPath'
        ? [{ name: 'Videos', extensions: ['mp4','mov','avi','mkv','webm'] }]
        : [{ name: 'Fonts', extensions: ['ttf','ttc','otf'] }];
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
  useEffect(() => {
    if (settings) {
      setTopHeightStr(String(settings.render.topCaptionHeight ?? ''));
      setBottomHeightStr(String(settings.render.bottomCaptionHeight ?? ''));
    }
  }, [settings?.render.topCaptionHeight, settings?.render.bottomCaptionHeight]);


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
              <div key={account.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-4">
                   <Switch checked={account.isActive} onCheckedChange={() => toggleAccountActive(platform, account.id)} />
                  <span className={!account.isActive ? 'text-muted-foreground' : ''}>{account.id}</span>
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
                <div className="space-y-2">
                <Label>フォントファイル（任意）</Label>
                <div className="flex gap-2">
                  <Input value={settings?.render.fontFilePath || ''} readOnly placeholder=".ttf / .ttc / .otf" />
                  <Button variant="outline" onClick={() => handleSelectFile('fontFilePath')}>選択</Button>
                </div>
                <p className="text-xs text-muted-foreground">指定すると日本語の文字化けを回避できます（例: Meiryo, Yu Gothic など）。</p>
              </div>
                <div className="space-y-2">
                  <Label>上テロップ</Label>
                  <CaptionInput
                    placeholder="動画上部に表示されるテロップ"
                    value={settings?.render.captions.top || ''}
                    onChange={(text) => settings && updateSettings({ render: { ...settings.render, captions: { ...settings.render.captions, top: text } } })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>下テロップ</Label>
                  <CaptionInput
                    placeholder="動画下部に表示されるテロップ"
                    value={settings?.render.captions.bottom || ''}
                    onChange={(text) => settings && updateSettings({ render: { ...settings.render, captions: { ...settings.render.captions, bottom: text } } })}
                  />
                </div>
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
                <div className="space-y-2">
                  <Label>テロップ背景色</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={settings?.render.teleTextBg || '#000000'}
                      onChange={(e) => settings && updateSettings({ render: { ...settings.render, teleTextBg: e.target.value } })}
                      aria-label="テロップ背景色を選択"
                      className="h-9 w-12 rounded border"
                    />
                    <Input
                      placeholder="#000000"
                      value={settings?.render.teleTextBg || ''}
                      onChange={(e) => settings && updateSettings({ render: { ...settings.render, teleTextBg: e.target.value } })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>テロップ文字色</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={settings?.render.captionTextColor || '#ffffff'}
                      onChange={(e) => settings && updateSettings({ render: { ...settings.render, captionTextColor: e.target.value } })}
                      aria-label="テロップ文字色を選択"
                      className="h-9 w-12 rounded border"
                    />
                    <Input
                      placeholder="#ffffff"
                      value={settings?.render.captionTextColor || ''}
                      onChange={(e) => settings && updateSettings({ render: { ...settings.render, captionTextColor: e.target.value } })}
                    />
                  </div>
                </div>
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
                <div className="space-y-2">
                <Label>テロップ位置（上）</Label>
                <Select
                  value={settings?.render.topCaptionPosition ?? 'center'}
                  onValueChange={(value: 'top'|'center'|'bottom') => settings && updateSettings({ render: { ...settings.render, topCaptionPosition: value } })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="上テロップの位置" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top">上寄せ</SelectItem>
                    <SelectItem value="center">中央</SelectItem>
                    <SelectItem value="bottom">下寄せ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>上テロップ微調整（px）</Label>
                <Input
                  type="number"
                  step={1}
                  value={settings?.render.topCaptionOffset ?? 0}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, topCaptionOffset: Number(e.target.value) || 0 } })}
                />
                <p className="text-xs text-muted-foreground">上ボックス内での上下オフセット（負で上/正で下）。</p>
              </div>
              <div className="space-y-2">
                <Label>テロップ位置（下）</Label>
                <Select
                  value={settings?.render.bottomCaptionPosition ?? 'center'}
                  onValueChange={(value: 'top'|'center'|'bottom') => settings && updateSettings({ render: { ...settings.render, bottomCaptionPosition: value } })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="下テロップの位置" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top">上寄せ</SelectItem>
                    <SelectItem value="center">中央</SelectItem>
                    <SelectItem value="bottom">下寄せ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>下テロップ微調整（px）</Label>
                <Input
                  type="number"
                  step={1}
                  value={settings?.render.bottomCaptionOffset ?? 0}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, bottomCaptionOffset: Number(e.target.value) || 0 } })}
                />
                <p className="text-xs text-muted-foreground">下ボックス内での上下オフセット（負で上/正で下）。</p>
              </div>
                <div className="space-y-2">
                <Label>上テロップ背景の高さ</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={topHeightStr}
                  onChange={(e) => setTopHeightStr(e.target.value)}
                  onBlur={() => {
                    if (!settings) return;
                    const n = Math.max(0, parseInt(topHeightStr || '0', 10) || 0);
                    updateSettings({ render: { ...settings.render, topCaptionHeight: n } });
                    setTopHeightStr(String(n));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  }}
                />
              </div>
                <div className="space-y-2">
                <Label>下テロップ背景の高さ</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={bottomHeightStr}
                  onChange={(e) => setBottomHeightStr(e.target.value)}
                  onBlur={() => {
                    if (!settings) return;
                    const n = Math.max(0, parseInt(bottomHeightStr || '0', 10) || 0);
                    updateSettings({ render: { ...settings.render, bottomCaptionHeight: n } });
                    setBottomHeightStr(String(n));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  }}
                />
              </div>
                <div className="space-y-2">
                <Label>テロップ背景の透明度 (0.0 - 1.0)</Label>
                <Input
                  type="number"
                  min={0.0}
                  max={1.0}
                  step={0.1}
                  value={settings ? settings.render.captionBgOpacity : ''}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, captionBgOpacity: Number(e.target.value) } })}
                />
              </div>
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
                <div>上テロップ: {settings?.render.captions.top || '(なし)'} / 下テロップ: {settings?.render.captions.bottom || '(なし)'}</div>
                <div>解像度: {settings?.render.resolution.width}x{settings?.render.resolution.height} / スケール: {settings?.render.scale}</div>
                <div>フォント: {settings?.render.fontFilePath ? '指定あり' : '未指定（既定フォント探索）'}</div>
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

// IMEに配慮したキャプション入力（合成時の確定を遅延）
function CaptionInput({ value, onChange, placeholder, maxLength }: { value: string; onChange: (text: string) => void; placeholder?: string; maxLength?: number }) {
  const [local, setLocal] = useState<string>(value ?? '');
  const [composing, setComposing] = useState(false);

  // 外部値変更に追従（編集中は維持）
  useEffect(() => {
    if (!composing) setLocal(value ?? '');
  }, [value, composing]);

  return (
    <Input
      type="text"
      value={local}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => {
        const v = e.target.value;
        setLocal(v);
        if (!composing) onChange(v);
      }}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={(e) => {
        setComposing(false);
        const v = (e.target as HTMLInputElement).value;
        onChange(v);
      }}
      onBlur={(e) => {
        const v = (e.target as HTMLInputElement).value;
        onChange(v);
      }}
    />
  );
}

// リアルタイムの簡易プレビュー（Canvas）
function RenderPreview() {
  const { settings } = useSettings();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const cfg = settings?.render;
  const width = Math.max(180, Math.min(540, Math.round((cfg?.resolution.width ?? 1080) / 4)));
  const height = Math.max(320, Math.min(960, Math.round((cfg?.resolution.height ?? 1920) / 4)));
  // Clamp caption heights so they never cover the whole screen
  const userTopH = Math.max(0, cfg?.topCaptionHeight ?? Math.round((cfg?.resolution.height ?? 1920) * (120 / 1920)));
  const userBottomH = Math.max(0, cfg?.bottomCaptionHeight ?? Math.round((cfg?.resolution.height ?? 1920) * (160 / 1920)));
  const minContent = Math.max(10, Math.round(height * 0.3));
  const topH = Math.min(userTopH, Math.max(0, height - minContent));
  const bottomH = Math.min(userBottomH, Math.max(0, height - topH - minContent));
  const bgColor = cfg?.teleTextBg ?? '#000000';
  const opacity = Math.max(0, Math.min(1, cfg?.captionBgOpacity ?? 1));
  const scale = Math.max(0.05, Math.min(5, cfg?.scale ?? 0.8));

  const topText = cfg?.captions.top ?? '';
  const bottomText = cfg?.captions.bottom ?? '';
  const textColor = cfg?.captionTextColor ?? '#ffffff';
  const topPos = (cfg?.topCaptionPosition as 'top'|'center'|'bottom') ?? 'center';
  const bottomPos = (cfg?.bottomCaptionPosition as 'top'|'center'|'bottom') ?? 'center';
  const overlayPos = (cfg?.overlayPosition as 'center'|'top-center'|'bottom-center'|'custom') ?? 'center';
  const topOffset = cfg?.topCaptionOffset ?? 0;
  const bottomOffset = cfg?.bottomCaptionOffset ?? 0;

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

    // 上下ボックス
    ctx.fillStyle = hexWithAlpha(bgColor, opacity);
    // top
    ctx.fillRect(0, 0, width, Math.min(topH, height));
    // bottom
    ctx.fillRect(0, Math.max(0, height - bottomH), width, Math.min(bottomH, height));

    // 擬似オーバーレイ（中央寄せ、上下ボックスの安全領域内）
    const safeHeight = Math.max(0, height - topH - bottomH);
    const fgW = Math.min(width, Math.round(width * scale));
    const fgH = Math.min(safeHeight, Math.round(safeHeight * scale));
    const fgX = Math.round((width - fgW) / 2);
  // overlayPosition: center/top-center/bottom-center を反映
  let fgY: number;
    const pos = overlayPos;
    if (pos === 'top-center') fgY = Math.round(topH);
    else if (pos === 'bottom-center') fgY = Math.round(height - bottomH - fgH);
  else fgY = Math.round(topH + (safeHeight - fgH) / 2);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(fgX, fgY, fgW, fgH);

  // テキスト
  ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    // フォントサイズは概要値
    const topFont = Math.max(10, Math.round(height * (48 / 1920)));
    const bottomFont = Math.max(10, Math.round(height * (42 / 1920)));

    // 上テキスト（位置指定: top/center/bottom）
    ctx.font = `${topFont}px sans-serif`;
    if (topPos === 'top') {
      ctx.textBaseline = 'top';
      const y = Math.max(0, Math.min(topH, 4 + topOffset));
      ctx.fillText(topText, Math.round(width / 2), y);
    } else if (topPos === 'bottom') {
      ctx.textBaseline = 'bottom';
      const y = Math.max(0, topH - 4 + topOffset);
      ctx.fillText(topText, Math.round(width / 2), y);
    } else {
      ctx.textBaseline = 'middle';
      const y = Math.round(topH / 2) + topOffset;
      // clamp inside box
      const yClamped = Math.max(0, Math.min(topH, y));
      ctx.fillText(topText, Math.round(width / 2), yClamped);
    }

    // 下テキスト（位置指定: top/center/bottom）
    ctx.font = `${bottomFont}px sans-serif`;
    if (bottomPos === 'top') {
      ctx.textBaseline = 'top';
      const y = Math.round(height - bottomH + 4 + bottomOffset);
      ctx.fillText(bottomText, Math.round(width / 2), y);
    } else if (bottomPos === 'bottom') {
      ctx.textBaseline = 'bottom';
      const y = Math.max(0, height - 4 + bottomOffset);
      ctx.fillText(bottomText, Math.round(width / 2), y);
    } else {
      ctx.textBaseline = 'middle';
      const y = Math.round(height - bottomH / 2) + bottomOffset;
      const minY = Math.round(height - bottomH);
      const maxY = Math.round(height);
      const yClamped = Math.max(minY, Math.min(maxY, y));
      ctx.fillText(bottomText, Math.round(width / 2), yClamped);
    }
  }, [width, height, topH, bottomH, bgColor, opacity, scale, topText, bottomText, textColor, topPos, bottomPos, overlayPos, topOffset, bottomOffset]);

  return (
    <div className="rounded-md border bg-background p-3 inline-block">
      <canvas ref={canvasRef} style={{ width: `${width}px`, height: `${height}px` }} />
    </div>
  );
}

function hexWithAlpha(hex: string, alpha: number) {
  // #RRGGBB を rgba(r,g,b,a) に変換
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default Settings;
