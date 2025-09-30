import { ChangeEvent, useCallback, useState } from 'react';
import styled from 'styled-components';
import { RunnerConfig, RunnerSummary } from '@core/types';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  font-family: 'Segoe UI', sans-serif;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
  min-height: 100vh;
`;

const Section = styled.section`
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(6px);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 20px 45px rgba(79, 70, 229, 0.1);
`;

const Heading = styled.h1`
  font-size: 28px;
  margin: 0;
  color: #312e81;
`;

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
`;

const Label = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-weight: 600;
  color: #4338ca;
`;

const Input = styled.input`
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(99, 102, 241, 0.3);
  background: rgba(255, 255, 255, 0.9);
  transition: box-shadow 0.2s ease;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.3);
  }
`;

const Button = styled.button`
  align-self: flex-start;
  padding: 12px 24px;
  font-weight: 600;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
  box-shadow: 0 15px 30px rgba(99, 102, 241, 0.3);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 20px 40px rgba(99, 102, 241, 0.4);
  }
`;

const SummaryCard = styled.div`
  padding: 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(129, 140, 248, 0.2);
  color: #312e81;
`;

declare global {
  interface Window {
    captureAPI?: {
      runCapture: (config: RunnerConfig) => Promise<RunnerSummary>;
    };
  }
}

const defaultConfig: RunnerConfig = {
  handle: 'kandounekodouga',
  count: 10,
  selector: '/html/body/div[1]/div/div/div[2]/main/div/div/div/div/div/section/div/div/div[1]/div/div/article',
  outDir: './outputs',
  headless: false,
  parallel: 2,
  browserChannel: 'chrome',
  storageStatePath: './storageState.json'
};

export function App() {
  const [config, setConfig] = useState<RunnerConfig>(defaultConfig);
  const [summary, setSummary] = useState<RunnerSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTextChange = useCallback(
    (key: keyof RunnerConfig) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        setConfig((prev) => ({ ...prev, [key]: event.target.value }));
      },
    []
  );

  const handleNumberChange = useCallback(
    (key: keyof RunnerConfig) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const value = Number(event.target.value);
        setConfig((prev) => ({ ...prev, [key]: Number.isNaN(value) ? prev[key] : value }));
      },
    []
  );

  const handleCheckboxChange = useCallback(
    (key: keyof RunnerConfig) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        setConfig((prev) => ({ ...prev, [key]: event.target.checked }));
      },
    []
  );

  const handleSubmit = async () => {
    if (!window.captureAPI) {
      setError('Electron preload がロードされていません。');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const result = await window.captureAPI.runCapture(config);
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Container>
      <Section>
        <Heading>CaptureApp コントロールセンター</Heading>
        <p>最新の X ポストをキャプチャし、動画合成まで自動で処理します。</p>
        <FormGrid>
          <Label>
            ターゲット @handle
            <Input
              value={config.handle}
              onChange={handleTextChange('handle')}
            />
          </Label>
          <Label>
            取得件数
            <Input
              type="number"
              value={config.count}
              min={1}
              max={20}
              onChange={handleNumberChange('count')}
            />
          </Label>
          <Label>
            範囲セレクタ
            <Input
              value={config.selector}
              onChange={handleTextChange('selector')}
            />
          </Label>
          <Label>
            出力ディレクトリ
            <Input value={config.outDir} onChange={handleTextChange('outDir')} />
          </Label>
          <Label>
            storageState.json パス
            <Input
              value={config.storageStatePath}
              onChange={handleTextChange('storageStatePath')}
            />
          </Label>
          <Label>
            ヘッドレスモード
            <Input
              type="checkbox"
              checked={config.headless}
              onChange={handleCheckboxChange('headless')}
            />
          </Label>
          <Label>
            並列処理数
            <Input
              type="number"
              value={config.parallel}
              min={1}
              max={4}
              onChange={handleNumberChange('parallel')}
            />
          </Label>
          <Label>
            ブラウザチャネル
            <Input value={config.browserChannel} onChange={handleTextChange('browserChannel')} />
          </Label>
        </FormGrid>
        <Button onClick={handleSubmit} disabled={running}>
          {running ? '処理中...' : 'キャプチャ実行'}
        </Button>
        {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      </Section>

      {summary && (
        <Section>
          <Heading>結果サマリー</Heading>
          <SummaryCard>
            <div>Run ID: {summary.runId}</div>
            <div>対象: @{summary.handle}</div>
            <div>
              成功: {summary.success} / {summary.total}
            </div>
            <div>部分成功: {summary.partial}</div>
            <div>失敗: {summary.failed}</div>
            <div>出力先: {summary.outputsDir}</div>
          </SummaryCard>
        </Section>
      )}
    </Container>
  );
}
