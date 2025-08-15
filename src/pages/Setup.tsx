import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Seo } from "@/components/Seo";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Setup = () => {
  const navigate = useNavigate();
  const [setupStatus, setSetupStatus] = useState<
    "idle" | "checking" | "installing" | "completed" | "failed"
  >("idle");
  const [progress, setProgress] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);
  const [checks, setChecks] = useState({
    node: { status: "pending", message: "Node.js を確認中..." },
    npm: { status: "pending", message: "npm を確認中..." },
    ffmpeg: { status: "pending", message: "FFmpeg を確認中..." },
  });

  const addMessage = (msg: string) => {
    setMessages((prev) => [...prev, msg]);
  };

  const runSetup = async () => {
    setSetupStatus("checking");
    setMessages([]);
    setProgress(0);

    addMessage("セットアップを開始します...");

    const dependencies = ['node', 'npm', 'ffmpeg'];
    let allSuccess = true;

    for (const dep of dependencies) {
      setChecks((prev) => ({ ...prev, [dep]: { ...prev[dep], status: "checking" } }));
      addMessage(`${dep} のバージョンを確認中...`);
      try {
        const result = await window.electronAPI.checkAndInstallDependencies(dep);
        if (result.success) {
          setChecks((prev) => ({ ...prev, [dep]: { status: "success", message: `${dep} が見つかりました。${result.message}` } }));
          addMessage(`${dep} のバージョン確認: 成功 - ${result.message}`);
        } else {
          setChecks((prev) => ({ ...prev, [dep]: { status: "failed", message: `${dep} が見つかりません。${result.message}` } }));
          addMessage(`${dep} のバージョン確認: 失敗 - ${result.message}`);
          allSuccess = false;
          break; // Stop on first failure
        }
      } catch (error: any) {
        setChecks((prev) => ({ ...prev, [dep]: { status: "failed", message: `${dep} の確認中にエラーが発生しました。${error.message}` } }));
        addMessage(`${dep} の確認中にエラーが発生しました: ${error.message}`);
        allSuccess = false;
        break; // Stop on first failure
      }
      setProgress((prev) => prev + (100 / dependencies.length));
    }

    if (allSuccess) {
      setSetupStatus("completed");
      addMessage("セットアップが完了しました！");
    } else {
      setSetupStatus("failed");
      addMessage("セットアップに失敗しました。ログを確認してください。");
    }
  };

  useEffect(() => {
    if (setupStatus === "idle") {
      runSetup();
    }
  }, [setupStatus]);

  const getStatusIcon = (status: string) => {
    if (status === "success") return <CheckCircle className="text-green-500" />;
    if (status === "failed") return <XCircle className="text-red-500" />;
    if (status === "checking" || status === "installing")
      return <Loader2 className="animate-spin text-blue-500" />;
    return null;
  };

  return (
    <div className="container mx-auto p-6 space-y-8">
      <Seo title="セットアップ" description="アプリケーションの初期セットアップを行います。" />

      <div className="space-y-2">
        <h1 className="text-2xl font-bold">初期セットアップ</h1>
        <p className="text-muted-foreground">
          アプリケーションの実行に必要な環境を自動で確認・設定します。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>環境チェックとインストール</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {Object.entries(checks).map(([key, check]) => (
              <div key={key} className="flex items-center gap-2">
                {getStatusIcon(check.status)}
                <span>{check.message}</span>
              </div>
            ))}
          </div>
          <Progress value={progress} className="w-full" />
          <div className="h-40 overflow-y-auto border rounded-md p-2 text-sm bg-gray-100 dark:bg-gray-800">
            {messages.map((msg, index) => (
              <p key={index} className="text-muted-foreground">
                {msg}
              </p>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            {setupStatus === "failed" && (
              <Button onClick={runSetup} variant="outline">
                再試行
              </Button>
            )}
            {setupStatus === "completed" && (
              <Button onClick={() => navigate("/")}>
                ダッシュボードへ
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Setup;