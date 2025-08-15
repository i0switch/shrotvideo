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
import { useState, useEffect } from "react"; // Add useEffect

const Settings = () => {
  const { settings, isLoading, isError, error, updateSettings, isUpdating } = useSettings();
  const [newAccounts, setNewAccounts] = useState<Record<Platform, string>>({
    x: '',
    tiktok: '',
    instagram: '',
    youtube: '',
  });

  // New: State for login credentials
  const [loginCredentials, setLoginCredentials] = useState<Record<Platform, { username: string; password: string }>>({
    x: { username: '', password: '' },
    tiktok: { username: '', password: '' },
    instagram: { username: '', password: '' },
    youtube: { username: '', password: '' },
  });
  const [loggedInStatus, setLoggedInStatus] = useState<Record<Platform, boolean>>({
    x: false,
    tiktok: false,
    instagram: false,
    youtube: false,
  });


  const handleSelectFile = async (key: 'bgmPath' | 'backgroundVideoPath') => {
    const result = await window.electronAPI.openFileDialog();
    if (result && settings) {
      updateSettings({ render: { ...settings.render, [key]: result } });
      toast({ title: "ファイルが選択されました", description: result });
    }
  };

  const handleSelectDirectory = async () => {
    const result = await window.electronAPI.openDirectoryDialog();
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
      const newAccount: Account = { id: newAccountId, isActive: true };
      const updatedAccounts = [...currentAccounts, newAccount];
      updateSettings({
        platforms: {
          ...settings.platforms,
          [platform]: { ...settings.platforms[platform], accounts: updatedAccounts },
        },
      });
      setNewAccounts(prev => ({ ...prev, [platform]: '' }));
      toast({ title: "アカウントが追加されました" });
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
  const getService = (platform: Platform) => `com.gemini.shortvideotool.${platform}`;

  const loadCredential = async (platform: Platform) => {
    const service = getService(platform);
    const username = loginCredentials[platform].username; // Use the username from state
    if (!username) {
      setLoggedInStatus(prev => ({ ...prev, [platform]: false }));
      return;
    }
    const password = await window.electronAPI.getCredential(service, username);
    if (password) {
      setLoggedInStatus(prev => ({ ...prev, [platform]: true }));
      // Do not set password to state for security reasons
    } else {
      setLoggedInStatus(prev => ({ ...prev, [platform]: false }));
    }
  };

  const handleLogin = async (platform: Platform) => {
    const { username, password } = loginCredentials[platform];
    if (!username || !password) {
      toast({ title: "エラー", description: "ユーザー名とパスワードを入力してください。", variant: "destructive" });
      return;
    }
    const service = getService(platform);
    const success = await window.electronAPI.setCredential(service, username, password);
    if (success) {
      toast({ title: "ログイン情報が保存されました" });
      setLoggedInStatus(prev => ({ ...prev, [platform]: true }));
      // Clear password from state after saving
      setLoginCredentials(prev => ({ ...prev, [platform]: { ...prev[platform], password: '' } }));
    } else {
      toast({ title: "エラー", description: "ログイン情報の保存に失敗しました。", variant: "destructive" });
      setLoggedInStatus(prev => ({ ...prev, [platform]: false }));
    }
  };

  const handleLogout = async (platform: Platform) => {
    const { username } = loginCredentials[platform];
    if (!username) {
      toast({ title: "エラー", description: "ログアウトするアカウントが指定されていません。", variant: "destructive" });
      return;
    }
    const service = getService(platform);
    const success = await window.electronAPI.deleteCredential(service, username);
    if (success) {
      toast({ title: "ログイン情報が削除されました" });
      setLoggedInStatus(prev => ({ ...prev, [platform]: false }));
      setLoginCredentials(prev => ({ ...prev, [platform]: { username: '', password: '' } }));
    } else {
      toast({ title: "エラー", description: "ログイン情報の削除に失敗しました。", variant: "destructive" });
    }
  };

  // Load credentials when platform tab is selected
  const handleTabChange = (value: string) => {
    const platform = value as Platform;
    if (['x', 'tiktok', 'instagram', 'youtube'].includes(platform)) {
      // Assuming the first account in the list is the primary one for login status check
      const primaryAccount = settings?.platforms[platform].accounts[0]?.id;
      if (primaryAccount) {
        setLoginCredentials(prev => ({ ...prev, [platform]: { ...prev[platform], username: primaryAccount } }));
        loadCredential(platform);
      } else {
        setLoggedInStatus(prev => ({ ...prev, [platform]: false }));
        setLoginCredentials(prev => ({ ...prev, [platform]: { username: '', password: '' } }));
      }
    }
  };


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

        {/* New: Login Information Card */}
        <Card>
          <CardHeader>
            <CardTitle>{name} ログイン情報</CardTitle>
            <CardDescription>
              {name}へのログイン情報を保存します。パスワードは安全に暗号化されます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${platform}-login-username`}>ユーザー名 / アカウントID</Label>
              <Input
                id={`${platform}-login-username`}
                value={loginCredentials[platform].username}
                onChange={(e) => setLoginCredentials(prev => ({ ...prev, [platform]: { ...prev[platform], username: e.target.value } }))}
                placeholder="ログインに使用するユーザー名またはアカウントID"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${platform}-login-password`}>パスワード / トークン</Label>
              <Input
                id={`${platform}-login-password`}
                type="password" // Use type="password" for security
                value={loginCredentials[platform].password}
                onChange={(e) => setLoginCredentials(prev => ({ ...prev, [platform]: { ...prev[platform], password: e.target.value } }))}
                placeholder="ログインに使用するパスワードまたはトークン"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
              <div className="space-y-0.5">
                <Label>ログインステータス</Label>
                <p className="text-xs text-muted-foreground">
                  現在のログイン状態:{" "}
                  {loggedInStatus[platform] ? (
                    <span className="text-green-500">ログイン済み</span>
                  ) : (
                    <span className="text-red-500">未ログイン</span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => handleLogin(platform)} disabled={loggedInStatus[platform]}>
                  ログイン
                </Button>
                <Button variant="destructive" onClick={() => handleLogout(platform)} disabled={!loggedInStatus[platform]}>
                  ログアウト
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
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
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="x">X</TabsTrigger>
          <TabsTrigger value="tiktok">TikTok</TabsTrigger>
          <TabsTrigger value="instagram">Instagram</TabsTrigger>
          <TabsTrigger value="youtube">YouTube</TabsTrigger>
          <TabsTrigger value="render">動画生成</TabsTrigger>
          <TabsTrigger value="general">一般</TabsTrigger>
        </TabsList>

        {renderPlatformSettings('x', 'X (旧Twitter)')}
        {renderPlatformSettings('tiktok', 'TikTok')}
        {renderPlatformSettings('instagram', 'Instagram')}
        {renderPlatformSettings('youtube', 'YouTube')}

        <TabsContent value="render">
          <Card>
            <CardHeader>
              <CardTitle>動画合成設定</CardTitle>
              <CardDescription>生成される動画の見た目や品質を設定します。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              {/* Render settings UI here */}
              <div className="space-y-2">
                <Label>解像度</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="幅"
                    value={settings?.render.resolution.width}
                    onChange={(e) => settings && updateSettings({ render: { ...settings.render, resolution: { ...settings.render.resolution, width: Number(e.target.value) } } })}
                  />
                  <Input
                    type="number"
                    placeholder="高さ"
                    value={settings?.render.resolution.height}
                    onChange={(e) => settings && updateSettings({ render: { ...settings.render, resolution: { ...settings.render.resolution, height: Number(e.target.value) } } })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>動画の長さ（秒）</Label>
                <Input
                  type="number"
                  min={1}
                  value={settings?.render.durationSec}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, durationSec: Number(e.target.value) } })}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>BGM</Label>
                <div className="flex gap-2">
                  <Input value={settings?.render.bgmPath || ''} readOnly placeholder="BGMファイル..." />
                  <Button variant="outline" onClick={() => handleSelectFile('bgmPath')}>選択</Button>
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>背景動画</Label>
                <div className="flex gap-2">
                  <Input value={settings?.render.backgroundVideoPath || ''} readOnly placeholder="背景動画ファイル..." />
                  <Button variant="outline" onClick={() => handleSelectFile('backgroundVideoPath')}>選択</Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>上テロップ</Label>
                <Input
                  placeholder="動画上部に表示されるテロップ"
                  value={settings?.render.captions.top || ''}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, captions: { ...settings.render.captions, top: e.target.value } } })}
                />
              </div>
              <div className="space-y-2">
                <Label>下テロップ</Label>
                <Input
                  placeholder="動画下部に表示されるテロップ"
                  value={settings?.render.captions.bottom || ''}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, captions: { ...settings.render.captions, bottom: e.target.value } } })}
                />
              </div>
              <div className="space-y-2">
                <Label>スケール</Label>
                <Input
                  type="number"
                  min={0.1}
                  max={1.0}
                  step={0.1}
                  value={settings?.render.scale}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, scale: Number(e.target.value) } })}
                />
              </div>
              <div className="space-y-2">
                <Label>テロップ背景色 (HEX)</Label>
                <Input
                  placeholder="#000000"
                  value={settings?.render.teleTextBg || ''}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, teleTextBg: e.target.value } })}
                />
              </div>
              <div className="space-y-2">
                <Label>品質プリセット</Label>
                <Select
                  value={settings?.render.qualityPreset}
                  onValueChange={(value: 'low' | 'standard' | 'high') => settings && updateSettings({ render: { ...settings.render, qualityPreset: value } })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="品質を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">低</SelectItem>
                    <SelectItem value="standard">標準</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>オーバーレイ位置</Label>
                <Select
                  value={settings?.render.overlayPosition}
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
                <Label>上テロップ背景の高さ</Label>
                <Input
                  type="number"
                  min={0}
                  value={settings?.render.topCaptionHeight}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, topCaptionHeight: Number(e.target.value) } })}
                />
              </div>
              <div className="space-y-2">
                <Label>下テロップ背景の高さ</Label>
                <Input
                  type="number"
                  min={0}
                  value={settings?.render.bottomCaptionHeight}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, bottomCaptionHeight: Number(e.target.value) } })}
                />
              </div>
              <div className="space-y-2">
                <Label>テロップ背景の透明度 (0.0 - 1.0)</Label>
                <Input
                  type="number"
                  min={0.0}
                  max={1.0}
                  step={0.1}
                  value={settings?.render.captionBgOpacity}
                  onChange={(e) => settings && updateSettings({ render: { ...settings.render, captionBgOpacity: Number(e.target.value) } })}
                />
              </div>
              {/* More render settings can be added here */}
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
              <div className="space-y-2">
                <Label htmlFor="outputPath">出力先ディレクトリ</Label>
                <div className="flex gap-2">
                  <Input id="outputPath" value={settings?.general.outputPath || ''} readOnly />
                  <Button variant="outline" onClick={handleSelectDirectory}>選択</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Settings;
