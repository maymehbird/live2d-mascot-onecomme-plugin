import { execFile } from "node:child_process";

let pending: Promise<string> | undefined;

/** ユーザー操作時だけ起動するWindows標準ダイアログ。パスはstdout経由で受け取る。 */
export function pickBridgeFile(): Promise<string> {
  if (process.platform !== "win32") return Promise.reject(new Error("参照ボタンはWindowsに対応しています。パスを入力してください。"));
  if (pending) return pending;
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$picker = New-Object System.Windows.Forms.OpenFileDialog
$picker.Title = 'Live2D Desktop Mascot の bridge.json を選択'
$picker.Filter = 'bridge.json (bridge.json)|bridge.json|JSON (*.json)|*.json'
$picker.InitialDirectory = [System.IO.Path]::Combine($env:APPDATA, 'Live2D Desktop Mascot')
$picker.CheckFileExists = $true
try { if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($picker.FileName) } }
finally { $picker.Dispose() }
`;
  pending = new Promise<string>((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      {windowsHide: true, timeout: 120000, encoding: "utf8", maxBuffer: 16384},
      (error, stdout) => error ? reject(new Error("ファイル選択を開けませんでした。パスを直接入力してください。")) : resolve(stdout.trim()));
  }).finally(() => { pending = undefined; });
  return pending;
}
