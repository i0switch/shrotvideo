const Help = () => (
  <div className="container mx-auto p-6 space-y-6">
    <h1 className="text-2xl font-bold">ヘルプ</h1>
    <div className="space-y-3 text-sm leading-6">
      <p>このアプリは X（旧Twitter）のポストを取得し、背景動画の上にスクショと短尺動画を貼り付けて出力します。</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>取得は既定でモック動作（ネットワーク不要）。設定でスクレイピングをONにすると実際に取得します。</li>
        <li>貼り付け要素は常にキャンバスの80%以内に内接スケールされます（アスペクト比保持）。</li>
        <li>テキストは黒背景・パディング・縁取りを自動適用します。</li>
        <li>品質プリセットはエンコード設定に反映されます（低: CRF28/veryfast・標準: CRF23/fast・高: CRF18/slow）。</li>
        <li>出力は設定の「出力先ディレクトリ」に mp4 で保存されます。</li>
        <li>スケジューラをONにすると、指定のURLを一定間隔で 取得→合成 します。</li>
      </ul>
      <p className="text-muted-foreground">前提: Windows に ffmpeg/ffprobe がインストールされ、PATH で利用可能であること。</p>
    </div>
  </div>
);

export default Help;
